const { PeerList } = require('./peers')
const { compose } = require('stream')
const { Splitter, Framer } = require('./net/framing')

class Core {
  constructor (config) {
    this.config = config
    this.peers = new PeerList(this)
    this.dht = null
    this.proto = null
  }

  makeProtoHandler (socket) {
    compose(
      new Framer(),
      socket,
      new Splitter()
    )
  }
}

module.exports = { Core }
