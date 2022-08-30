// https://github.com/PrismarineJS/node-minecraft-protocol/blob/master/src/transforms/framing.js
const { Transform } = require('stream')

class Framer extends Transform {
  _transform (chunk, _, cb) {
    const buffer = Buffer.allocUnsafe(2 + chunk.length)
    buffer.writeUInt16BE(chunk.length)
    chunk.copy(buffer, 2)
    this.push(buffer)
    return cb()
  }
}

class Splitter extends Transform {
  constructor () {
    super()
    this.buffer = Buffer.allocUnsafe(0)
  }

  _transform (chunk, _, cb) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    // Waiting for >2 bytes to safely ignore empty packets
    if (this.buffer.length < 3) return cb()
    let offset = 0
    let value = this.buffer.readUInt16BE()
    while (this.buffer.length > offset + value + 2) {
      this.push(this.buffer.subarray(offset + 2, offset + 2 + value))
      offset += 2 + value
      if (this.buffer.length - offset < 2) break
      value = this.buffer.readUInt16BE(offset)
    }
    this.buffer = this.buffer.subarray(offset)
    return cb()
  }
}

module.exports = { Splitter, Framer }
