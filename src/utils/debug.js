const debug = require('debug')('yggdrasil')
const { Transform } = require('stream')

class Logger extends Transform {
  constructor (name) {
    super({ readableObjectMode: true, writableObjectMode: true })
    this.logger = debug.extend(name)
  }

  _transform (chunk, _, cb) {
    this.logger('metadata' in chunk ? chunk.data : chunk)
    return cb(null, chunk)
  }
}

module.exports = { Logger, debug }
