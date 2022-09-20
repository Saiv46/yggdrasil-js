const { PeerList } = require('./peers')
const { compose } = require('stream')
const DHTree = require('./dhtree')
const { PrivateKey, PublicKey } = require('./utils/crypto')
// Logging
const Address = require('./utils/address')
const { debug } = require('./utils/debug')
const { VERSION } = require('./utils/constants')
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
    // Logging
    this.log = debug.extend('core')
    // this.log('Protocol: yggdrasil')
    this.log('Protocol version:', VERSION.join('.'))
    this.log('IPv6 address:', Address.fromPublicKey(this.publicKey.toBuffer()).toString())
    // this.log('IPv6 subnet:', Address.subnetFromPublicKey(this.publicKey.toBuffer()).toString())
    this.log('Public key:', this.publicKey.toString())
    // this.log('Coords:', this.dht.selfTreeInfo.hops)
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
