const { createConnection, createServer } = require('net')

module.exports.connect = function createTCPConnection (url) {
  const socket = createConnection(url.port, url.host)
    .setNoDelay()
    .setTimeout(url.timeout, () => socket.end())
  return socket
}

module.exports.listen = function createTCPServer (url) {
  return createServer({ noDelay: true })
    .listen(url.port, url.host)
}
