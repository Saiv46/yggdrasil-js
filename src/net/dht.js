const assert = require('assert')
const { Transform } = require('stream')
const { ed25519, PublicKey } = require('../utils/crypto')
const { Protocol } = require('./serialization')

class SenderMiddleware extends Transform {
  constructor (core, peer) {
    super({ readableObjectMode: true, writableObjectMode: true })
    this.core = core
    this.peer = peer
    // Hack to get ourself into the remote node's dhtree
  	// They send a similar message and we'll respond with correct info
    this.sendTree({ root: core.publicKey, seq: 0n, hops: [] })
  }

  async sendTree (treeInfo) {
    treeInfo.hops.push({
      next: this.peer.remoteKey,
      port: 0
    })
    if (treeInfo.root instanceof PublicKey) {
      treeInfo.root = treeInfo.root.toBuffer()
    }
    for (const hop of treeInfo.hops) {
      if (hop.next instanceof PublicKey) hop.next = hop.next.toBuffer()
    }
    treeInfo.hops[treeInfo.hops.length - 1].sign = await this.core.privateKey.sign(
      Protocol.createPacketBuffer('treeInfoNoSignature', treeInfo)
    )
    this.push({
      type: 'Tree',
      data: treeInfo
    })
  }

  _transform (chunk, _, cb) {
    return cb(null, chunk)
  }
}
module.exports.SenderMiddleware = SenderMiddleware

class RecieverMiddleware extends Transform {
  constructor (core, peer) {
    super({ readableObjectMode: true, writableObjectMode: true })
    this.core = core
    this.peer = peer
  }

  async handleTreeInfo (data) {
    // Verify that packet come from remote peer
    // last hop is to this node, 2nd to last is to the previous hop, which is who this is from
    if (data.hops.length > 1) {
      assert.ok(
        this.peer.remoteKey.compare(data.hops[data.hops.length - 2].next) === 0,
        'wireProcessError:treeInfo:pubkey:hops'
      )
    } else {
      assert.ok(
        this.peer.remoteKey.compare(data.root) === 0,
        'wireProcessError:treeInfo:pubkey:root'
      )
    }
    // Verify signatures
    // ironwood for some reason sign hops without previous signatures
    const buf = Protocol.createPacketBuffer('treeInfoNoSignature', data)
    let b = Protocol.sizeOf({
      root: data.root,
      seq: data.seq,
      hops: []
    }, 'treeInfoNoSignature')
    for (let i = 0; i < data.hops.length; i++) {
      b += Protocol.sizeOf(data.hops[i], 'treeHopNoSignature')
      assert(await ed25519.verify(
        data.hops[i].sign,
        buf.subarray(0, b),
        i ? data.hops[i - 1].next : data.root
      ), 'wireProcessError:treeInfo:verify:' + i)
    }
    this.core.dht.update(data, this.peer)
  }

  _transform ({ data: { type, data } }, _, cb) {
    switch (type) {
      case 'Heartbeat':
        break
      case 'Tree':
        this.handleTreeInfo(data)
        break
      case 'Bootstrap':
        this.core.dht.handleBootstrap(data)
        break
      case 'BootstrapAck':
        this.core.dht.handleBootstrapAck(data)
        break
      case 'Setup':
        this.core.dht.handleSetup(data)
        break
      case 'Teardown':
        this.core.dht.handleTeardown(data)
        break
      case 'PathNotify':
        this.core.dht.handlePathNotify(data)
        break
      case 'PathLookup':
        this.core.dht.handlePathLookup(data)
        break
      case 'PathResponse':
        this.core.dht.handlePathResponse(data)
        break
      case 'DHTTraffic':
      case 'PathTraffic':
        this.core.dht.handleTraffic(data)
        break
    }
    return cb()
  }
}
module.exports.RecieverMiddleware = RecieverMiddleware
