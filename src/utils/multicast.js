const { createSocket } = require('dgram')
const { networkInterfaces } = require('os')
const Address = require('./address')
const { PublicKey } = require('./crypto')

module.exports = class Multicast {
  static GROUP_ADDR6 = '[ff02::114]'

  constructor (core) {
    this.core = core
    this.interfaces = {}
    this.controller = new AbortController()
    this.start()
  }

  startInterface (name, beacon, listen, port, ips) {
    if (name in this.interfaces) return
    this.interfaces[name] = []
    for (const { address, family, internal } of ips) {
      if (internal || family !== 'IPv6') continue
      this.core.peers.listen(`tcp://${address}:${port}`)
      const socket = createSocket({
        type: 'udp6',
        reuseAddr: true,
        ipv6Only: true,
        signal: this.controller.signal
      })
      if (beacon) {
        const beacon = Buffer.concat([
          this.core.publicKey.toBuffer(),
          Address.parse(address),
          Buffer.from([port >> 8, port & 255])
        ])
        const int = setInterval(() => socket.write(beacon), 1000)
        this.controller.signal.addEventListener('abort', () => clearInterval(int))
      }
      if (listen) {
        socket.on('message', msg => this.beaconHandler(msg))
      }
      socket.bind(port, address, () => socket.addMembership(Multicast.GROUP_ADDR, name))
      this.interfaces[name].push(socket)
    }
  }

  start () {
    const interfaces = networkInterfaces()
    for (const {
      Regex,
      Beacon = false,
      Listen = false,
      Port = 0
    } of this.core.config.MulticastInterfaces) {
      if (!Beacon && !Listen) continue
      for (const name in interfaces) {
        if (!Regex.test(name)) continue
        this.startInterface(name, Beacon, Listen, Port, interfaces[name])
      }
    }
  }

  beaconHandler (message) {
    if (message.length < PublicKey.SIZE + Address.SIZE + 2) return
    const key = message.toString('hex', 0, PublicKey.SIZE)
    const addr = Address.stringify(message.subarray(PublicKey.SIZE, PublicKey.SIZE + Address.SIZE))
    const port = message.readUint16BE(PublicKey.SIZE + Address.SIZE)
    this.core.peers.add(`tcp://${addr}:${port}/?key=${key}`)
  }

  stop () {
    if (this.controller) this.controller.abort()
    this.controller = new AbortController()
    this.interfaces = {}
  }
}
