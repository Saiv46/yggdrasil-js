const assert = require('assert')
const { Transform } = require('stream')
const typeClasses = require('../utils/classes')

function generatePacketSenders () {
  const obj = {}
  for (const name in typeClasses) {
    const type = typeClasses[name]
    if (!type.PACKET_TYPE) continue
    obj[type.PACKET_TYPE] = (packet, core, peer) => packet.toBufferSigned
      ? packet.toBufferSigned(peer, core.privateKey)
      : packet.toBuffer()
  }
  return obj
}

function generatePacketHandlers () {
  const obj = {}
  for (const name in typeClasses) {
    const type = typeClasses[name]
    if (!type.PACKET_TYPE) continue
    obj[type.PACKET_TYPE] = data => new type(data)
  }
  return obj
}

class SenderMiddleware extends Transform {
  static PacketHandlers = generatePacketSenders()

  constructor (core, peer) {
    super({ readableObjectMode: true, writableObjectMode: true })
    this.core = core
    this.peer = peer
    // Hack to get ourself into the remote node's dhtree
    // They send a similar message and we'll respond with correct info
    this.write({ type: 'Tree', data: new typeClasses.TreeInfo({ root: core.publicKey }) })
    if (peer.info.timeout) {
      setInterval(
        () => this.push({ type: 'Heartbeat' }),
        Math.ceil(peer.info.timeout * 2 / 3)
      )
    }
  }

  _transform (chunk, _, cb) {
    if (chunk.type in SenderMiddleware.PacketHandlers) {
      Promise.resolve(
        SenderMiddleware.PacketHandlers[chunk.type](chunk.data, this.core, this.peer)
      ).then(data => this.push({ type: chunk.type, data }))
      return cb()
    }
    return cb(null, chunk)
  }
}
module.exports.SenderMiddleware = SenderMiddleware

class RecieverMiddleware extends Transform {
  static PacketHandlers = generatePacketHandlers()

  constructor (core, peer) {
    super({ readableObjectMode: true, writableObjectMode: true })
    this.core = core
    this.peer = peer
  }

  async handleTreeInfo (treeInfo) {
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

  async _transform ({ data: { type, data } }, _, cb) {
    if (type in RecieverMiddleware.PacketHandlers) {
      data = await RecieverMiddleware.PacketHandlers[type](data)
    }
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
    return cb(null, { type, data })
  }
}
module.exports.RecieverMiddleware = RecieverMiddleware
