const assert = require('assert')
const { PublicKey } = require('./crypto')

module.exports = class PeerURL {
  static timeoutDefault = 6000
  static supportedProtocols = {}
  constructor (string) {
    const url = new URL('http' + string.slice(string.indexOf('://')))
    this.protocol = string.slice(0, string.indexOf('://'))
    assert.ok(this.protocol in PeerURL.supportedProtocols, 'Unsupported protocol')
    this.host = url.hostname
    this.port = url.port
    this.options = url.pathname.substring(1)
    this.name = url.searchParams.get('sni')
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
    return !this.pinnedKeys || this.pinnedKeys.some(v => v.equal(key))
  }

  toString () {
    const url = new URL(`http://${this.host}:${this.port}/${this.options}`)
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
