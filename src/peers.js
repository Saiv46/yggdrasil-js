const assert = require('assert')
const { inspect } = require('node:util')
const { once } = require('events')
const { PublicKey } = require('./utils/crypto')
const { debug } = require('./utils/debug')
const wire = require('./wire')

const PeerURL = require('./utils/peerurl')
PeerURL.supportedProtocols = wire

const { VERSION } = require('./utils/constants')
const HEADER = Buffer.from('meta' + String.fromCharCode(...VERSION))

class PeerList {
  constructor (core) {
    this.core = core
    this.log = debug.extend('peers')
    this.listeners = new Map()
    this.peers = new Map()
    this.counter = 1
    core.config.Peers?.forEach?.(v => this.add(v))
    core.config.Listen?.forEach?.(v => this.listen(v))
  }

  async listen (url, server = null) {
    if (!(url instanceof PeerURL)) {
      url = new PeerURL(url)
    }
    if (PeerList.findURLEntry(this.listeners, url)) return
    const srv = await (server ?? wire[url.protocol].listen(url))
    srv.on('connection', socket => {
      const peer = new PeerURL(url.toString())
      if (socket.remotePort) peer.port = socket.remotePort
      if (socket.remoteAddress) peer.host = socket.remoteAddress
      this.add(peer, socket)
    })
    try {
      this.listeners.set(url, srv)
      await once(srv, 'listening')
      this.log('Listening on', url)
    } catch (e) {
      this.listeners.delete(url)
      await srv.close()
      throw e
    }
  }

  async unlisten (url) {
    if (!(url instanceof PeerURL)) {
      url = new PeerURL(url)
    }
    const key = PeerList.findURLEntry(this.listeners, url)
    if (!key) return
    const server = this.listeners.get(key)
    this.listeners.delete(key)
    await server.close()
    this.log('Stopped listening on', url)
  }

  async add (url, socket = null) {
    if (!(url instanceof PeerURL)) {
      url = new PeerURL(url)
    }
    if (PeerList.findURLEntry(this.peers, url)) return
    const peer = new PeerInfo(url, this.core)
    try {
      peer.port = this.counter++
      this.peers.set(url, peer)
      await peer.connect(socket)
      this.log('Connected to', peer)
    } catch (e) {
      this.peers.delete(url)
      await peer.close()
      this.log('Failed to connect to', e)
    }
  }

  async remove (url) {
    if (!(url instanceof PeerURL)) {
      url = new PeerURL(url)
    }
    const key = PeerList.findURLEntry(this.peers, url)
    if (!key) return
    const peer = this.peers.get(key)
    this.peers.delete(key)
    await peer.close()
    this.log('Disconnected', peer)
  }

  static findURLEntry (map, url) {
    for (const item of map.keys()) {
      if (item === url || item.isEqual(url)) return item
    }
    return null
  }
}

class PeerInfo {
  constructor (url, core) {
    this.info = url
    this.port = -1
    this.socket = null
    this.remoteKey = null
    this.pipeline = null
    this.core = core
  }

  async connect (socket) {
    const ac = new AbortController()
    setTimeout(() => ac.abort('Timeout'), 10_000)
    this.socket = await (socket ?? wire[this.info.protocol].connect(this.info))
    this.socket.once('error', err => ac.abort(err))
    if (this.socket.connecting) {
      await once(this.socket, 'ready', { signal: ac.signal })
    }
    this.socket.write(Buffer.concat([HEADER, this.core.publicKey.toBuffer()]))
    const [header] = await once(this.socket, 'data', { signal: ac.signal })
    this.socket.pause() // Need to pause socket after once
    assert.ok(HEADER.compare(header, 0, HEADER.length) === 0, 'Invalid header (incompatible version?)')
    this.remoteKey = new PublicKey(header.subarray(HEADER.length, HEADER.length + PublicKey.SIZE))
    if (socket) {
      assert.ok(this.core.publicKeyAllowed(this.remoteKey), 'Not allowed public key')
    } else {
      assert.ok(this.info.hasValidPublicKey(this.remoteKey), 'Invalid pinned public key')
    }
    await this.core.makeProtoHandler(this)
    this.pipeline.on('error', async (e) => {
      this.core.peers.log('Peer error', this, e)
      await this.core.peers.remove(this.info)
    })
  }

  async close () {
    const ac = new AbortController()
    setTimeout(() => ac.abort('Timeout'), 10_000)
    try {
      this.socket.end()
      await once(this.socket, 'close', { signal: ac.signal })
    } catch (e) {
      this.socket.destroy()
    } finally {
      if (this.pipeline) this.pipeline.destroy()
      this.core.dht.removePeer(this)
    }
  }

  [inspect.custom] () {
    return `PeerInfo#${this.port} @ ${this.info.toString()}`
  }
}

module.exports = { PeerList, PeerInfo }
