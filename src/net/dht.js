const assert = require('assert')
const { Transform } = require('stream')
const { ed25519 } = require('../utils/crypto')
const { Protocol } = require('./serialization')

class SenderMiddleware extends Transform {
  constructor (core, peer) {
    super({ readableObjectMode: true, writableObjectMode: true })
    this.core = core
    this.peer = peer
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
    this.core.dht.update(data)
  }

  _transform ({ data: chunk }, _, cb) {
    switch (chunk.type) {
      case 'Heartbeat':
        break
      case 'Tree':
        this.handleTreeInfo(chunk.data)
        break
      case 'Bootstrap':
        this.core.dht.handleBootstrap(chunk.data)
        break
      case 'BootstrapAck':
        this.core.dht.handleBootstrapAck(chunk.data)
        break
      case 'Setup':
        this.core.dht.handleSetup(chunk.data)
        break
      case 'Teardown':
        this.core.dht.handleTeardown(chunk.data)
        break
      case 'PathNotify':
        this.core.dht.handlePathNotify(chunk.data)
        break
      case 'PathLookup':
        this.core.dht.handlePathLookup(chunk.data)
        break
      case 'PathResponse':
        this.core.dht.handlePathResponse(chunk.data)
        break
      case 'DHTTraffic':
        this.core.dht.handleDHTTraffic(
          Object.assign(chunk.data.traffic, { path: chunk.data.path })
        )
        break
      case 'PathTraffic':
        this.core.dht.handlePathTraffic(chunk.data)
        break
    }
    return cb()
  }
}
module.exports.RecieverMiddleware = RecieverMiddleware
