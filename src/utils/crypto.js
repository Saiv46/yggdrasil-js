const assert = require('assert')
const ed25519 = require('@noble/ed25519')

class AbstractKey {
  constructor (key) {
    this.data = Buffer.from(key, 'hex')
    assert.strictEqual(this.length, this.constructor.SIZE, 'Invalid key size')
  }

  get length () { return this.data.length }
  toBuffer () { return this.data }
  toString () { return this.data.toString('hex') }
}

class PrivateKey extends AbstractKey {
  static SIZE = 64
  async sign (data) {
    return Buffer.from(await ed25519.sign(data, this.data.subarray(0, 32)))
  }

  static async generate () {
    const priv = await ed25519.utils.randomPrivateKey()
    const pub = await ed25519.getPublicKey(priv)
    return new PrivateKey(Buffer.concat([priv, pub]))
  }
}

class PublicKey extends AbstractKey {
  static SIZE = 32
  async verify (data, sign) {
    return ed25519.verify(sign, data, this.data)
  }

  equal (key) {
    return key === this || this.data.compare(key.data) === 0
  }

  less (key) {
    for (let i = 0; i < this.data.length; i++) {
      const c = this.data[i] - key.data[i]
      if (c) return c < 0
    }
    return false
  }

  hash () {
    return (2n ** 192n - 1n) * this.data.readBigUInt64BE(0) +
      (2n ** 128n - 1n) * this.data.readBigUInt64BE(8) +
      (2n ** 64n - 1n) * this.data.readBigUInt64BE(16) +
      this.data.readBigUInt64BE(24)
  }

  static fromHash (value) {
    const buf = Buffer.allocUnsafe(PublicKey.SIZE)
    buf.writeBigUInt64BE((value >> 192n) & (2n ** 64n - 1n), 0)
    buf.writeBigUInt64BE((value >> 128n) & (2n ** 64n - 1n), 8)
    buf.writeBigUInt64BE((value >> 64n) & (2n ** 64n - 1n), 16)
    buf.writeBigUInt64BE(value & (2n ** 64n - 1n), 24)
    return new PublicKey(buf)
  }

  static async fromPrivateKey (privateKey) {
    return new PublicKey(
      privateKey instanceof PrivateKey
        ? privateKey.toBuffer().subarray(PublicKey.SIZE)
        : await ed25519.getPublicKey(privateKey.subarray(-PublicKey.SIZE))
    )
  }

  static from (key) {
    return key instanceof PublicKey ? key : new PublicKey(key)
  }
}

module.exports = {
  PrivateKey,
  PublicKey,
  ed25519
}
