const { createSocket } = require('dgram')

module.exports = class Multicast {
  static GROUP_ADDR = '[ff02::114]'

  constructor (config) {
    this.config = config
    this.socket = null
    if (this.config.MulticastInterfaces.length) {
      this.start()
    }
  }

  start () {
    this.socket = createSocket({
      type: 'udp6',
      reuseAddr: true,
      ipv6Only: true
    })
    if (this.config.MulticastInterfaces) {
      // TODO
    }
    this.socket.bind(9001, () => this.socket.addMembership(Multicast.GROUP_ADDR))
  }
}
