const { Duplex } = require('node:stream')
const EventEmitter = require('node:events')
const dgram = require('node:dgram')
const { isIP } = require('node:net')
const dns = require('node:dns').promises

async function resolveHostname (url, skipLookup = false) {
  if (isIP(url.host) || skipLookup) {
    return {
      address: url.host,
      family: isIP(url.host)
    }
  }
  return await dns.lookup(url.host, { verbatim: false })
}

class UDPClient extends Duplex {
  constructor(type, port, host) {
    super()
    this.remotePort = port
    this.remoteAddress = host

    this.socket = dgram.createSocket(type)
    this.connecting = true
    this._reading = true
    this.socket.on('message', data => {
      console.log('Rec', data)
      if (this._reading) this._reading = this.push(data)
    })
    this.on('newListener', (...args) => this.socket.on(...args))
    this.socket.on('connect', () => {
      this.connecting = false
      console.log('Ready')
      this.emit('ready')
    })
    this.socket.connect(port, host)
  }
  _read() { this._reading = true }

  _writev(chunks, callback) {
    const sendChunk = () => {
      let size = 0
      let i = 0
      if (!chunks.length) {
        callback()
        return
      }
      while (size < 1472 && i < chunks.length) {
        size += chunks[i].chunk.length
        i++
      }
      this.socket.send(chunks.splice(0, i).map(a => a.chunk), sendChunk)
    }
    sendChunk()
  }

  _write(chunk, _, cb) {
    console.log('Send', chunk)
    this.socket.send(chunk, cb)
  }
}

class UDPServer extends EventEmitter {
  constructor(type, port, host) {
    super()
    this.socket = dgram.createSocket(type)
    this.socket.on('message', (data, rinfo) => {
      console.log('New', data, rinfo)
      const conn = new UDPClient(rinfo.family === 'IPv6' ? 'udp6' : 'udp4', rinfo.port, rinfo.address)
      this.emit('connection', conn)
      conn.once('ready', () => conn.socket.emit('message', data))
    })
    this.on('newListener', (...args) => this.socket.on(...args))
    this.socket.bind(port, host)
  }

  close () {
    this.socket.close()
  }
}

module.exports.connect = async function createUDPConnection(url) {
  const { address, family } = await resolveHostname(url)
  return new UDPClient(`udp${family}`, url.port, address)
}

module.exports.listen = async function createUDPServer(url) {
  const { address, family } = await resolveHostname(url, true)
  return new UDPServer(`udp${family || 4}`, url.port, address)
}
