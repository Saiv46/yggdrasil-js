const assert = require('assert')
const { PublicKey } = require('./utils/crypto')

module.exports = class Address {
  static PREFIX = 0x02
  static SUBNET_FLAG = 0x01
  static SIZE = 16
  static SUBNET_SIZE = 8

  constructor (addr) {
    this.value = typeof addr === 'string'
      ? Address.parse(addr)
      : Buffer.from(addr)
    assert.strictEqual(this.value[0] & ~Address.SUBNET_FLAG, Address.PREFIX, 'Invalid address prefix')
    assert.strictEqual(this.value.length, Address.SIZE, 'Invalid address size')
  }

  toPartialKey () {
    const buf = Buffer.alloc(PublicKey.SIZE)
    const bitShift = (this.value[1] + 1) % 8
    // const maskNext = (255 << (8 - bitShift)) & 255
    buf[0] = this.value[1] >> bitShift
    buf[0] |= 1 << (8 - bitShift)
    for (let i = 2, io = 1 + this.value[1] & ~7; i < this.value.length || io < buf.length; i++, io++) {
      buf[io] = this.value[i] >> bitShift
      buf[io] |= this.value[i - 1] << (8 - bitShift)
      buf[io] ^= 255
    }
    return buf
  }

  get length () { return this.value.length }
  toBuffer () { return this.value }
  toString () {
    const str = []
    for (let i = 0; i < this.value.length; i += 2) {
      str.push(this.value.readUInt16BE(i).toString(16))
    }
    return `[${str.join(':').replace(/\b:?(?:0+:?){2,}/, '::')}]`
  }

  toJSON () { return this.toString() }
  static parse (str) {
    const hex = str.slice(+str.startsWith('['), str.length - str.endsWith(']')).split(':')
    let offset = 0
    const buf = Buffer.alloc(Address.SIZE)
    for (let i = 0; i < hex.length; i++) {
      if (hex[i].length) {
        buf.writeUInt16BE(parseInt(hex[i], 16), (offset + i) * 2)
      } else {
        offset = Address.SUBNET_SIZE - hex.length
      }
    }
    return buf
  }

  static fromPublicKey (key) {
    assert.strictEqual(key.length, PublicKey.SIZE, 'Invalid public key size')
    const buf = Buffer.alloc(Address.SIZE)
    buf[0] = Address.PREFIX
    for (let i = 0; i < key.length; i += 4) {
      buf[1] += Math.clz32(key.readUint32BE(i))
      if (buf[1] & 31) break
    }
    const bitShift = (buf[1] + 1) % 8
    const maskNext = (255 << (8 - bitShift)) & 255
    for (let i = buf[1] & ~7, io = 2; i < key.length || io < buf.length; i++, io++) {
      buf[io] = key[i] << bitShift
      buf[io] |= (key[i + 1] & maskNext) >> (8 - bitShift)
      buf[io] ^= 255
    }
    return new Address(buf)
  }

  static subnetFromPublicKey (key) {
    const addr = Address.fromPublicKey(key)
    addr.value[0] |= Address.SUBNET_FLAG
    addr.value.fill(0, Address.SUBNET_SIZE)
    return addr
  }

  static validateAddress (addr) {
    if (typeof addr === 'string') {
      addr = Address.parse(addr)
    }
    assert.strictEqual(addr[0] & ~Address.SUBNET_FLAG, Address.PREFIX, 'Invalid prefix')
    assert.strictEqual(
      addr.length,
      (addr & Address.SUBNET_FLAG) === Address.SUBNET_FLAG
        ? this.SUBNET_SIZE
        : this.SIZE,
      'Malformed key'
    )
  }
}
