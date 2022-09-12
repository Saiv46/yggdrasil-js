const assert = require('assert')
const { Transform } = require('stream')
const { TreeInfo } = require('../utils/classes')

class SenderMiddleware extends Transform {
  constructor (core, peer) {
    super({ readableObjectMode: true, writableObjectMode: true })
    this.core = core
    this.peer = peer
    // Hack to get ourself into the remote node's dhtree
    // They send a similar message and we'll respond with correct info
    this.sendTreeInfo(new TreeInfo({ root: core.publicKey }))
    if (peer.info.timeout) {
      setInterval(
        () => this.push({ type: 'Heartbeat' }),
        Math.ceil(peer.info.timeout * 2 / 3)
      )
    }
  }

  async sendTreeInfo (treeInfo) {
    this.push({
      type: 'Tree',
      data: await treeInfo.toBufferSigned(this.peer, this.core.privateKey)
    })
  }

  _transform (chunk, _, cb) {
    switch (chunk.type) {
      case 'Tree':
        this.sendTreeInfo(chunk.data)
        return cb()
    }
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
    const treeInfo = new TreeInfo(data)
    // Verify that packet come from remote peer...
    assert.ok(
      this.peer.remoteKey.equal(treeInfo.hopFrom()),
      'wireProcessError:treeInfo:pubkey:from'
    )
    // ...to us
    assert.ok(
      this.core.publicKey.equal(treeInfo.hopDest()),
      'wireProcessError:treeInfo:pubkey:from'
    )
    // Verify signatures
    // ironwood for some reason sign hops without previous signatures
    assert(await treeInfo.verifySignatures(), 'wireProcessError:treeInfo:verify')
    this.core.dht.handleTreeInfo(treeInfo, this.peer)
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
