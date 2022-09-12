const { TreeInfo, TreeExpiredInfo, Bootstrap, TreeLabel } = require('./utils/classes')
const { PublicKey } = require('./utils/crypto')
const { debug } = require('./utils/debug')

// WARNING: This is a port from Ironwood
// TODO: Refactor everything

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
  }
  update (data) { console.log('update', data) }

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
        this.log('Switching root to ourself')
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
    for (const info of this.dhtInfoByPeer.value()) {
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
      // This has a loop, e.g. it's from a child, so skip it
      if (!info.isLoopSafe()) continue
      let decision = 0
      // Is this is a better root?
      decision += info.root.less(this.selfTreeInfo.root)
      decision -= this.selfTreeInfo.root.less(info.root)
      // Compare sequence numbers
      decision += info.seq > this.selfTreeInfo.seq
      decision -= info.seq < this.selfTreeInfo.seq
      // Is this has been around for longer (e.g. the path is more stable)
      decision += info.hseq < this.selfTreeInfo.hseq
      // If any of two conditions is true - switch root to this peer
      if (decision > 1) {
        this.selfTreeInfo = info
        this.parentPeer = peer
      }
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
        : this.rootExpiration.get(this.selfTreeInfo.root).time + treeTIMEOUT - Date.now()
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
      const bootstrap = new Bootstrap({
        label: new TreeLabel({
          key: this.core.publicKey,
          root: this.selfTreeInfo.root,
          seq: this.selfTreeInfo.seq,
          hops: this.selfTreeInfo.hops.map(v => v.port)
        })
      })
      await bootstrap.label.sign(this.core.privateKey)
      this.handleBootstrap(bootstrap)
    }

    this.bootstrapTimer = setTimeout(() => {
      this.bootstrapTimer = 0
      this.attemptBootstrap()
    }, 1000)
  }

  handleBootstrap (data) { console.log('bootstrap', data) }
  handleBootstrapAck (data) { console.log('bootstrapAck', data) }
  handleSetup (data) { console.log('setup', data) }
  handleTeardown (data) { console.log('teardown', data) }
  handlePathNotify (data) { console.log('pathNotify', data) }
  handlePathLookup (data) { console.log('pathLookup', data) }
  handlePathResponse (data) { console.log('pathResponse', data) }
  // TODO: Move to net/dht
  handleTraffic (data) { console.log('traffic', data) }
  handleDHTTraffic (data) { console.log('DHTTraffic', data) }
  handlePathTraffic (data) { console.log('pathTraffic', data) }
}
