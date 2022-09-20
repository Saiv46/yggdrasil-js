const debug = require('debug')('yggdrasil')
const { Transform } = require('stream')

class Logger extends Transform {
  constructor (name, ...prefix) {
    super({ readableObjectMode: true, writableObjectMode: true })
    this.logger = debug.extend(name)
    this.prefix = prefix
  }

  _transform (chunk, _, cb) {
    this.logger(...this.prefix, 'metadata' in chunk ? chunk.data : chunk)
    return cb(null, chunk)
  }
}

module.exports = { Logger, debug }
