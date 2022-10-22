const {
  TreeInfo,
  TreeExpiredInfo,
  Bootstrap,
  BootstrapAck,
  TreeLabel,
  SetupToken
} = require('./utils/classes')
const { PublicKey } = require('./utils/crypto')
const { debug } = require('./utils/debug')

// WARNING: This is a port from Ironwood
// TODO: Replace spanning tree routing with something else

const treeTIMEOUT = 60 * 60 * 1000 // TODO figure out what makes sense
const treeANNOUNCE = treeTIMEOUT / 2
// const treeTHROTTLE = treeANNOUNCE / 2 // TODO use this to limit how fast seqs can update

module.exports = class DHTree {
  constructor (core) {
    this.core = core
    this.log = debug.extend('dht')
    // Maps
    this.treeInfoByPeer = new Map()
    this.rootExpiration = new Map() // Stores root latest seq and time
    this.dhtInfoByPeerInfo = new Map()
    // Local data
    this.selfTreeInfo = null
    this.parentPeer = null
    // Variables
    this.seq = process.hrtime.bigint()
    for (let i = 0n; i < 8n; i++) {
      // Using crypto.getRandomValues() is meaningless
      this.seq |= BigInt((Math.random() * 256) | 0) << (8n * i)
    }
    this.hseq = 0n // Used to order without timestamps
    this.isRootSwitching = false // True when switching root to ourself
    this.selfExpireTimer = 0 // A timer to make selfTreeInfo expire
    this.bootstrapTimer = 0

    this.fixParent()
  }

  handleTreeInfo (treeInfo, peer) {
    treeInfo.hseq = ++this.hseq
    const rootHash = treeInfo.root.hash()
    if (
      !this.rootExpiration.has(rootHash) ||
      this.rootExpiration.get(rootHash).seq < treeInfo.seq
    ) {
      this.rootExpiration.set(rootHash, new TreeExpiredInfo(treeInfo))
    }
    if (!this.treeInfoByPeer.has(peer)) {
      // We just connected to peer, reply with our tree
      this.sendTreeInfo(peer)
    }
    this.treeInfoByPeer.set(peer, treeInfo)
    if (peer === this.parentPeer) {
      // If we have stronger key (worse root) or
      // became online earlier than parent,
      // then switch tree root to ourself
      this.isRootSwitching = this.selfTreeInfo.root.less(treeInfo.root) ||
        (
          this.selfTreeInfo.root.equal(treeInfo.root) &&
          treeInfo.seq <= this.selfTreeInfo.seq
        )
      this.selfTreeInfo = null
      this.parentPeer = null
      if (this.isRootSwitching) {
        this.selfTreeInfo = new TreeInfo({ root: this.core.publicKey })
        this.broadcastTreeInfo()
        // TODO(what) We wait for a second to avoid "storms"
        setTimeout(() => {
          this.isRootSwitching = false
          this.selfTreeInfo = null
          this.parentPeer = null
          this.fixParent()
          this.attemptBootstrap()
        }, 1000)
      }
    }
    if (!this.isRootSwitching) {
      this.fixParent()
      this.attemptBootstrap()
    }
  }

  removePeer (peer) {
    const oldInfo = this.treeInfoByPeer.get(peer)
    if (!oldInfo) return
    this.treeInfoByPeer.delete(peer)
    if (this.selfTreeInfo === oldInfo) {
      this.selfTreeInfo = null
      this.parentPeer = null
      this.fixParent()
    }
    for (const info of this.dhtInfoByPeerInfo.values()) {
      if (info.peer === peer || info.rest === peer) {
        this.dhtTeardown(peer, info)
      }
    }
  }

  sendTreeInfo (peer) {
    if (!this.selfTreeInfo) return
    peer.pipeline.write({
      type: 'Tree',
      data: this.selfTreeInfo
    })
  }

  broadcastTreeInfo () {
    for (const peer of this.treeInfoByPeer.keys()) {
      this.sendTreeInfo(peer)
    }
  }

  fixParent () {
    const oldSelf = this.selfTreeInfo
    if (this.selfTreeInfo === null || this.core.publicKey.less(this.selfTreeInfo.root)) {
      this.selfTreeInfo = new TreeInfo({ root: this.core.publicKey })
      this.parentPeer = null
    }
    for (const [peer, info] of this.treeInfoByPeer.entries()) {
      switch (true) {
        // This has a loop, e.g. it's from a child, so skip it
        case !info.isLoopSafe():
          continue
        // Is this is a better root?
        case !info.root.equal(this.selfTreeInfo.root):
          if (this.selfTreeInfo.root.less(info.root)) continue
          break
        // Compare sequence numbers
        case info.seq !== this.selfTreeInfo.seq:
          if (info.seq < this.selfTreeInfo.seq) continue
          break
        case info.hseq < this.selfTreeInfo.hseq:
          break
        default:
          continue
      }
      // If any of conditions above is true - switch root to this peer
      this.selfTreeInfo = info
      this.parentPeer = peer
    }
    if (this.selfTreeInfo !== oldSelf) {
      this.log('Selected new tree info', this.selfTreeInfo)
      // Reset a timer to make selfTreeInfo expire at some point
      if (this.selfExpireTimer) clearTimeout(this.selfExpireTimer)
      const self = this.selfTreeInfo
      this.selfExpireTimer = setTimeout(() => {
        if (this.selfTreeInfo === self) {
          this.selfTreeInfo = null
          this.parentPeer = null
          this.fixParent()
          this.attemptBootstrap()
        }
      }, this.selfTreeInfo.root.equal(this.core.publicKey)
        // We are the root, so we need to expire after treeANNOUNCE to update seq
        ? treeANNOUNCE
        // Figure out when the root needs to time out
        : (this.rootExpiration.get(this.selfTreeInfo.root.hash())?.time ?? 0) + treeTIMEOUT - Date.now()
      )
      this.broadcastTreeInfo()
    }

    // Remove anything worse than the current root
    for (const hash of this.rootExpiration.keys()) {
      const key = PublicKey.fromHash(hash)
      if (key.equal(this.selfTreeInfo.root) || this.selfTreeInfo.root.less(key)) {
        this.rootExpiration.delete(hash)
      }
    }
  }

  async attemptBootstrap () {
    if (this.bootstrapTimer) return
    if (
      this.prevPeer &&
      this.prevPeer.root.equal(this.selfTreeInfo.root) &&
      this.prevPeer.rootSeq === this.selfTreeInfo.seq
    ) {
      return
    }

    if (!this.selfTreeInfo.root.equal(this.core.publicKey)) {
      this.log('Bootstraping ourself')
      this.handleBootstrap(await this.createTreeLabel(true))
    }

    this.bootstrapTimer = setTimeout(() => {
      this.bootstrapTimer = 0
      this.attemptBootstrap()
    }, 1000)
  }

  // _teardown removes the path associated with the teardown from our dht
  // and forwards it to the next hop along that path (or does nothing if
  // the teardown doesn't match a known path)
  dhtTeardown (peer, teardown) {
    const mapKey = dhtMapKey(teardown)
    const dInfo = this.dhtInfoByPeerInfo.get(mapKey)
    if (!dInfo) return
    if (teardown.seq !== dInfo.seq) return
    let next = null
    if (peer === dInfo.peer) {
      next = dInfo.rest
    } else if (peer === dInfo.rest) {
      next = dInfo.peer
    } else {
      return // throw new Error('teardown of path from wrong node')
    }
    clearTimeout(dInfo.timer)
    this.dhtWeakKeys.delete(dInfo)
    this.dhtInfoByPeerInfo.delete(mapKey)
    if (next) {
      next.pipeline.write({
        type: 'Teardown',
        data: teardown
      })
    }
    if (this.nextPeer === dInfo) {
      this.nextPeer = null
    }
    if (this.prevPeer === dInfo) {
      this.prevPeer = null
      // It's possible that other bad news is incoming
      // Delay bootstrap until we've processed any other queued messages
      setTimeout(() => this.attemptBootstrap(), 0)
    }
  }

  // _treeLookup selects the best next hop (in treespace) for the destination
  _treeLookup (dest) {
    if (this.core.publicKey.equal(dest.key)) {
      return null
    }
    let best = this.selfTreeInfo
    let bestDist = best.distanceToLabel(dest)
    let bestPeer = null
    for (const [peer, info] of this.treeInfoByPeer.entries()) {
      if (!info.root.equal(dest.root) || info.seq !== dest.seq) {
        continue
      }
      const dist = info.distanceToLabel(dest, -1)
      if (dist < bestDist || info.hopFrom().less(best.hopFrom())) {
        best = info
        bestDist = dist
        bestPeer = peer
      }
    }
    if (!best.root.equal(dest.root) || best.seq !== dest.seq) return null
    return bestPeer
  }

  // _dhtLookup selects the next hop needed to route closer to the destination in dht keyspace
  // this only uses the source direction of paths through the dht
  // bootstraps use slightly different logic, since they need to stop short of the destination key
  _dhtLookup (dest, isBootstrap = false) {
    // Start by defining variables and helper functions
    let best = this.core.publicKey
    let bestPeer
    let bestInfo
    // doUpdate is just to make sure we don't forget to update something
    const doUpdate = (key, peer, info) => {
      best = key
      bestPeer = peer
      bestInfo = info
    }
    // doCheckedUpdate checks if the provided key is better than the current best, and updates if so
    const doCheckedUpdate = (key, peer, info) => {
      switch (true) {
        case !isBootstrap && key.equal(dest) && !best.equal(dest):
        case dhtOrdered(best, key, dest):
          doUpdate(key, peer, info)
      }
    }
    // doAncestry updates based on the ancestry information in a treeInfo
    const doAncestry = (info, peer) => {
      doCheckedUpdate(info.root, peer, null) // updates if the root is better
      for (const hop of info.hops) {
        doCheckedUpdate(hop.nextPeer, peer, null) // updates if this hop is better
        const tinfo = this.treeInfoByPeer.get(bestPeer) // may be nil if we're in the middle of a remove
        if (tinfo && best.equal(hop.nextPeer) && info.hseq < tinfo.hseq) {
          // This ancestor matches our current next hop, but this peer's treeInfo is better, so switch to it
          doUpdate(hop.nextPeer, peer, null)
        }
      }
    }
    // doDHT updates best based on a DHT path
    const doDHT = (info) => {
      doCheckedUpdate(info.key, info.peer, info) // updates if the source is better
      if (bestInfo && info.key.equal(bestInfo.key)) {
        if (info.root.less(bestInfo.root)) {
          doUpdate(info.key, info.peer, info) // same source, but the root is better
        } else if (info.root.equal(bestInfo.root) && info.rootSeq > bestInfo.rootSeq) {
          doUpdate(info.key, info.peer, info) // same source, same root, but the rootSeq is newer
        }
      }
    }
    // Update the best key and peer
    // First check if the current best (ourself) is an invalid next hop
    if ((isBootstrap && best.equal(dest)) || dhtOrdered(this.selfTreeInfo.root, dest, best)) {
      // We're the current best, and we're already too far through keyspace
      // That means we need to default to heading towards the root
      doUpdate(this.selfTreeInfo.root, this.parentPeer, null)
    }
    // Update based on the ancestry of our own treeInfo
    doAncestry(this.selfTreeInfo, this.parentPeer)
    // Update based on the ancestry of our peers
    for (const [peer, info] of this.treeInfoByPeer.entries()) {
      doAncestry(info, peer)
    }
    // Check peers
    for (const peer of this.treeInfoByPeer.keys()) {
      if (best.equal(peer.remoteKey)) {
        // The best next hop is one of our peers
        // We may have stumbled upon them too early, as the ancestor of another peer
        // Switch to using the direct route to this peer, just in case
        doUpdate(peer.remoteKey, peer, null)
      }
    }
    // Update based on our DHT infos
    for (const info of this.dhtInfoByPeerInfo.keys()) {
      doDHT(info)
    }
    return bestPeer
  }

  async handleBootstrap (data) {
    const source = data.key
    // If we know a better prev peer for bootstraping node
    const next = this._dhtLookup(source, true)
    if (next) return next.pipeline.write({ type: 'Bootstrap', data })
    // If not, send our BootstrapAck
    if (source.equal(this.core.publicKey) || !(await data.verify())) return
    const ack = new BootstrapAck({
      bootstrap: data,
      response: new SetupToken({
        source,
        destination: await this.createTreeLabel()
      })
    })
    await ack.response.sign(this.core.privateKey)
    this.handleBootstrapAck(ack)
  }

  async handleBootstrapAck (data) {
    const source = data.response.destLabel.key
    const next = this._treeLookup(data.request)
    switch (true) {
      case next:
        return next.write({ type: 'BootstrapAck', data })
      case source.equal(this.core.publicKey):
        // This is our own ack, but we failed to find a next hop
        return
      case !data.request.label.key.equal(this.core.publicKey):
        // This isn't an ack of our own bootstrap
        return
      case !data.response.source.equal(this.core.publicKey):
        // This is an ack of or own bootstrap, but the token isn't for us
        return
      case !data.response.destLabel.root.equal(this.selfTreeInfo.root):
        // We have a different root, so tree lookups would fail
        return
      case data.response.destLabel.seq !== this.selfTreeInfo.seq:
        // This response is too old, so path setup would fail
        return
      case !this.prevPeer:
        // We have no prev, so anything matching the above is good enough
        break
      case dhtOrdered(
        this.dhtInfoByPeerInfo.get(this.treeInfoByPeer(this.prevPeer)),
        source,
        this.core.publicKey
      ):
        // This is from a better prev than our current one
        break
      case !this.prevPeer?.root?.equal?.(this.selfTreeInfo.root) ||
        this.prevPeer?.rootSeq !== this.selfTreeInfo.seq:
      // The curent prev needs replacing (old tree info)
      default:
        // We already have a better (FIXME? or equal) prev
        return
    }
    // Final thing to check, if the signatures are bad then ignore it
    if (!(await data.response.verify())) return
    this.prevPeer = null
    /*
    for (const dinfo of this.dhtInfoByPeerInfo.values()) {
      // Former prev need to be notified that we're no longer next
      // The only way to signal that is by tearing down the path
      // We may have multiple former prev paths
      //  From t.prev = nil when the tree changes, but kept around to bootstrap
      // So loop over paths and close any going to a *different* node than the current prev
      // The current prev can close the old path from that side after setup
      const dest = t.dkeys[dinfo]
      if (dest && !dest.equal(source)) this.handleTeardown(dinfo.getTeardown())
    }
    */
    // const setup = new DHTSetup(data.response)
    // this.handleSetup(setup)
  }

  handleSetup (data) { console.log('setup', data) }
  handleTeardown (data) { console.log('teardown', data) }
  handlePathNotify (data) { console.log('pathNotify', data) }
  handlePathLookup (data) { console.log('pathLookup', data) }
  handlePathResponse (data) { console.log('pathResponse', data) }
  // TODO: Move to net/dht
  handleTraffic (data) { console.log('traffic', data) }

  async createTreeLabel (isBootstrap = false) {
    const label = new (isBootstrap ? Bootstrap : TreeLabel)({
      key: this.core.publicKey,
      root: this.selfTreeInfo.root,
      seq: this.selfTreeInfo.seq,
      path: this.selfTreeInfo.hops.map(v => v.localPort)
    })
    await label.sign(this.core.privateKey)
    return label
  }
}

function dhtOrdered (prev, curr, next) {
  return prev.less(curr) && curr.less(next)
}

function dhtMapKey ({ key, root, rootSeq }) {
  return key.hash(key) << (8 * PublicKey.SIZE) + root.hash(key) << 64 + rootSeq
}
