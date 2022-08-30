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
  isEqual (key) {
    return this.data.length === key.length &&
      this.data.compare(key.toBuffer()) === 0
  }
}

class PrivateKey extends AbstractKey {
  static SIZE = 64
  async sign (data) {
    return Buffer.from(await ed25519.sign(data, this.data))
  }

  static async generate () {
    return new PrivateKey(await ed25519.utils.randomPrivateKey())
  }
}

class PublicKey extends AbstractKey {
  static SIZE = 32
  async verify (data, sign) {
    return ed25519.verify(sign, data, this.data)
  }

  static async fromPrivateKey (privateKey) {
    return new PublicKey(await ed25519.getPublicKey(
      privateKey instanceof PrivateKey
        ? privateKey.toBuffer()
        : privateKey
    ))
  }
}

module.exports = {
  PrivateKey,
  PublicKey,
  ed25519
}
