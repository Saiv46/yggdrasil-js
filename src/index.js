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
    this.privateKey = new PrivateKey(this.config.PrivateKey)
    this.publicKey = new PublicKey(this.config.PublicKey)
    this.allowedKeys = this.config.AllowedPublicKeys?.map(v => new PublicKey(v))
    // Components
    this.peers = new PeerList(this)
    this.dht = new DHTree(this)
    this.proto = null
  }

  makeProtoHandler (peer) {
    const stream = compose(
      new Logger('proto:out', peer),
      new SenderMiddleware(this, peer),
      createSerializer(),
      new Framer(),
      peer.socket,
      new Splitter(),
      createDeserializer(),
      new RecieverMiddleware(this, peer),
      new Logger('proto:in', peer)
    )
    peer.pipeline = stream
  }

  publicKeyAllowed (key) {
    return !this.allowedKeys?.length || this.allowedKeys.some(v => v.equal(key))
  }
}
