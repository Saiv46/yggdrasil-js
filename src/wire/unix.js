const { createConnection, createServer } = require('net')

module.exports.connect = function createUnixConnection (url) {
  return createConnection('/' + url.host + (url.options ? ('/' + url.options) : ''))
}

module.exports.listen = function createUnixServer (url) {
  return createServer({ noDelay: true })
    .listen('/' + url.host + (url.options ? ('/' + url.options) : ''))
}
