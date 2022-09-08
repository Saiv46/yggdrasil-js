const assert = require('assert')
const { once } = require('events')
const { PublicKey } = require('./utils/crypto')
const wire = require('./wire')
const { VERSION } = require('./utils/constants')

const HEADER = Buffer.from('meta' + String.fromCharCode(...VERSION))

class PeerList {
  constructor (core) {
    this.core = core
    this.listeners = new Map()
    this.peers = new Map()
    core.config.Peers?.forEach?.(v => this.add(v))
    core.config.Listen?.forEach?.(v => this.listen(v))
  }

  async listen (url, server = null) {
    if (!(url instanceof PeerURL)) {
      url = new PeerURL(url)
    }
    if (PeerList.findURLEntry(this.listeners, url)) return
    const srv = server ?? wire[this.info.protocol].listen(this.info)
    srv.on('connection', socket => {
      const peer = new PeerURL(url.toString())
      peer.port = socket.remotePort
      peer.host = socket.remoteAddress
      this.add(peer, socket)
    })
    try {
      this.listeners.set(url, srv)
      await once(srv, 'listening')
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
  }

  async add (url, socket = null) {
    if (!(url instanceof PeerURL)) {
      url = new PeerURL(url)
    }
    if (PeerList.findURLEntry(this.peers, url)) return
    const peer = new PeerInfo(url, this.core)
    try {
      this.peers.set(url, peer)
      await peer.connect(socket)
    } catch (e) {
      this.peers.delete(url)
      await peer.close()
      throw new Error('Failed to add peer', { cause: e })
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
    this.core = core
  }

  async connect (socket) {
    const ac = new AbortController()
    setTimeout(() => ac.abort('Timeout'), 10_000)
    this.socket = socket ?? wire[this.info.protocol].connect(this.info)
    await once(this.socket, 'ready', { signal: ac.signal })
    this.socket.write(HEADER)
    this.socket.write(this.core.publicKey.toBuffer())
    const [header] = await once(this.socket, 'data', { signal: ac.signal })
    this.socket.pause() // Need to pause socket after once
    assert.ok(HEADER.compare(header, 0, HEADER.length) === 0, 'Invalid header (incompatible version?)')
    this.remoteKey = header.subarray(HEADER.length, HEADER.length + PublicKey.SIZE)
    if (socket) {
      assert.ok(this.core.publicKeyAllowed(this.remoteKey), 'Not allowed public key')
    } else {
      assert.ok(this.info.hasValidPublicKey(this.remoteKey), 'Invalid pinned public key')
    }
    this.core.makeProtoHandler(this)
  }

  async close () {
    const ac = new AbortController()
    setTimeout(() => ac.abort('Timeout'), 10_000)
    try {
      this.socket.close()
      await once(this.socket, 'close', { signal: ac.signal })
    } catch (e) {
      this.socket.destroy()
    } finally {
      this.core.dht.removePeer(this)
    }
  }
}

class PeerURL {
  static timeoutDefault = 6000
  constructor (string) {
    const url = new URL('http' + string.slice(string.indexOf('://')))
    this.protocol = string.slice(0, string.indexOf('://'))
    assert.ok(this.protocol in wire, 'Unsupported protocol')
    this.host = url.hostname
    this.port = url.port
    this.options = url.pathname.substring(1)
    this.name = url.searchParams.getAll('sni')
    this.timeout = url.searchParams.get('timeout') ?? PeerURL.timeoutDefault
    this.pinnedKeys = url.searchParams.has('key')
      ? url.searchParams.getAll('key').map(v => new PublicKey(v))
      : null
  }

  isEqual (peer) {
    return this.protocol === peer.protocol &&
      this.host === peer.host &&
      this.port === peer.port &&
      this.options === peer.options &&
      this.name === peer.name
  }

  hasValidPublicKey (key) {
    return !this.pinnedKeys || this.pinnedKeys.some(v => v.isEqual(key))
  }

  toString () {
    const url = new URL(`${this.protocol}://${this.host}:${this.port}/${this.options}`)
    if (this.name) url.searchParams.set('sni', this.name)
    if (this.timeout !== PeerURL.timeoutDefault) {
      url.searchParams.set('timeout', this.timeout)
    }
    if (this.pinnedKeys) {
      this.pinnedKeys.forEach(v => url.searchParams.append('key', v.toString()))
    }
    return this.protocol + url.toString().slice('http'.length)
  }
}

module.exports = { PeerList, PeerInfo, PeerURL }
