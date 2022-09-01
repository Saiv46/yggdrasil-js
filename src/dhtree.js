module.exports = class DHTree {
  update (data) { console.log('update', data) }
  handleBootstrap (data) { console.log('bootstrap', data) }
  handleBootstrapAck (data) { console.log('bootstrapAck', data) }
  handleSetup (data) { console.log('setup', data) }
  handleTeardown (data) { console.log('teardown', data) }
  handlePathNotify (data) { console.log('pathNotify', data) }
  handlePathLookup (data) { console.log('pathLookup', data) }
  handlePathResponse (data) { console.log('pathResponse', data) }
  // TODO: Move to net/dht
  handleDHTTraffic (data) { console.log('DHTTraffic', data) }
  handlePathTraffic (data) { console.log('pathTraffic', data) }
}
