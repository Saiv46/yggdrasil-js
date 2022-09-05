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
    let offset = 0
    while (offset + 2 <= this.buffer.length) {
      const length = this.buffer.readUInt16BE(offset, offset)
      if (offset + length + 2 < this.buffer.length) break
      offset += 2
      this.push(this.buffer.subarray(offset, offset + length))
    }
    if (offset) this.buffer = this.buffer.subarray(offset)
    return cb()
  }
}

module.exports = { Splitter, Framer }
