const { PeerList } = require('./peers')
const { compose } = require('stream')
const DHTree = require('./dhtree')
const { PrivateKey, PublicKey } = require('./utils/crypto')
// Streams
const { Logger } = require('./net/debug')
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
  }

  makeProtoHandler (peer) {
    const stream = compose(
      new Logger('stream:in'),
      new SenderMiddleware(this, peer),
      new Logger('proto:in'),
      createSerializer(),
      new Logger('frame:in'),
      new Framer(),
      new Logger('net:in'),
      peer.socket,
      new Logger('net:out'),
      new Splitter(),
      new Logger('frame:out'),
      createDeserializer(),
      new Logger('proto:out'),
      new RecieverMiddleware(this, peer),
      new Logger('stream:out')
    )
    if (peer.info.timeout) {
      setInterval(
        () => stream.write({ type: 'Heartbeat' }),
        Math.ceil(peer.info.timeout * 2/3)
      )
    }
    peer.pipeline = stream
  }
}
