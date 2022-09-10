const { PeerList } = require('./peers')
const { compose } = require('stream')
const DHTree = require('./dhtree')
const { PrivateKey, PublicKey } = require('./utils/crypto')
// Streams
const { Logger } = require('./utils/debug')
const { Splitter, Framer } = require('./net/framing')
const { SenderMiddleware, RecieverMiddleware } = require('./net/dht')
const { createSerializer, createDeserializer } = require('./net/serialization')

module.exports = class Core {
  constructor (config) {
    this.config = config
    this.peers = new PeerList(this)
    this.dht = new DHTree(this)
    this.proto = null

    this.privateKey = new PrivateKey(this.config.PrivateKey)
    this.publicKey = new PublicKey(this.config.PublicKey)
    this.allowedKeys = this.config.AllowedPublicKeys?.map(v => new PublicKey(v))
  }

  makeProtoHandler (peer) {
    const stream = compose(
      new Logger('net:stream:out'),
      new SenderMiddleware(this, peer),
      new Logger('net:proto:out'),
      createSerializer(),
      new Logger('net:frame:out'),
      new Framer(),
      new Logger('net:socket:out'),
      peer.socket,
      new Logger('net:socket:in'),
      new Splitter(),
      new Logger('net:frame:in'),
      createDeserializer(),
      new Logger('net:proto:in'),
      new RecieverMiddleware(this, peer),
      new Logger('net:stream:in')
    )
    if (peer.info.timeout) {
      setInterval(
        () => stream.write({ type: 'Heartbeat' }),
        Math.ceil(peer.info.timeout * 2 / 3)
      )
    }
    peer.pipeline = stream
  }

  publicKeyAllowed (key) {
    return !this.allowedKeys || this.allowedKeys.some(v => v.equal(key))
  }
}
