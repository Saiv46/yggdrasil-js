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

  static async fromPrivateKey (privateKey) {
    return new PublicKey(
      privateKey instanceof PrivateKey
        ? privateKey.toBuffer().subarray(PublicKey.SIZE)
        : await ed25519.getPublicKey(privateKey.subarray(0, PublicKey.SIZE))
    )
  }
}

module.exports = {
  PrivateKey,
  PublicKey,
  ed25519
}
