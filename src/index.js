const { PeerList } = require('./peers')
const { compose } = require('stream')
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
    compose(
      new SenderMiddleware(this, peer),
      createSerializer(),
      new Framer(),
      peer.socket,
      new Splitter(),
      createDeserializer(),
    )
  }
}
