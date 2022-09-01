const assert = require('assert')
const { Transform } = require('stream')
const { ed25519 } = require('../utils/crypto')

// https://github.com/Arceliar/ironwood/blob/main/network/wire.go#L8-L20
const packetTypeEnum = {
  wireDummy: 0,
  wireProtoTree: 1,
  wireProtoDHTBootstrap: 2,
  wireProtoDHTBootstrapAck: 3,
  wireProtoDHTSetup: 4,
  wireProtoDHTTeardown: 5,
  wireProtoPathNotify: 6,
  wireProtoPathLookup: 7,
  wireProtoPathResponse: 8,
  wireDHTTraffic: 9,
  wirePathTraffic: 10
}
module.exports.packetTypeEnum = packetTypeEnum

const trafficTypeEnum = {
  wireTrafficDummy: 0,
  wireTrafficStandard: 1,
  wireTrafficOutOfBand: 2
}
module.exports.trafficTypeEnum = trafficTypeEnum

class SenderMiddleware extends Transform {
  constructor (core, peer) {
    super()
    this.core = core
  }

  _transform (chunk, _, cb) {
    const buffer = Buffer.allocUnsafe(1 + chunk.length)
    buffer[0] = packetTypeEnum.wirePathTraffic // TODO
    chunk.copy(buffer, 1)
    this.push(buffer)
    return cb()
  }
}
module.exports.SenderMiddleware = SenderMiddleware

class RecieverMiddleware extends Transform {
  constructor (core, peer) {
    super()
    this.core = core
    this.peer = peer
  }

  static treeInfoSize = 32 + 8
  static treeHopSize = 32 + 8 + 64
  async handleTreeInfo (chunk) {
    // Check whatever we have enough bytes to read
    assert.ok(chunk.length >= RecieverMiddleware.treeInfoSize, 'wireDecodeError:wireProtoTree:treeInfo')
    const treeInfo = {
      root: chunk.subarray(0, 32), // public key
      seq: chunk.readBigUInt64BE(32), // sequence number
      hops: []
    }
    for (let i = RecieverMiddleware.treeInfoSize; i < chunk.length;) {
      const [port, start] = this.readVarInt(chunk.subarray(i + 32))
      treeInfo.hops.push({
        next: chunk.subarray(i, i += 32),
        port: (i += start, port), // FIXME: Need to change everything, that was not uint, but varint
        sig: chunk.subarray(i, i += 64)
      })
    }
    const hops = treeInfo.hops.length
    // Verify that packet come from remote peer
    // last hop is to this node, 2nd to last is to the previous hop, which is who this is from
    assert.ok(
      hops > 1
        ? this.peer.remoteKey.compare(treeInfo.hops[treeInfo.hops.length - 2]) === 0
        : this.peer.remoteKey.compare(treeInfo.root) === 0,
      'wireDecodeError:wireProtoTree:pubkey'
    )
    // Verify signatures
    // ironwood for some reason sign hops without previous signatures
    const buf = Buffer.allocUnsafe(RecieverMiddleware.treeInfoSize + (32 + 8) * hops)
    chunk.copy(buf, 0, 0, RecieverMiddleware.treeInfoSize)
    for (let i = 0; i < hops; i++) {
      chunk.copy(
        buf,
        RecieverMiddleware.treeInfoSize + (32 + 8) * i,
        RecieverMiddleware.treeInfoSize + RecieverMiddleware.treeHopSize * i,
        RecieverMiddleware.treeInfoSize + RecieverMiddleware.treeHopSize * i + 32 + 8
      )
      await ed25519.verify(
        treeInfo.hops[i].sig,
        buf.subarray(0, RecieverMiddleware.treeInfoSize + (32 + 8) * (i + 1)),
        i ? treeInfo.hops[i - 1].next : treeInfo.root
      )
    }
    /* // How it should be
    for (let i = 0; i < hops; i++) {
      await ed25519.verify(
        treeInfo.hops[i].sig,
        chunk.subarray(0, RecieverMiddleware.treeInfoSize + RecieverMiddleware.treeHopSize * i + 32 + 8),
        i ? treeInfo.hops[i - 1].next : treeInfo.root
      )
    }
    */
    this.core.dht.update(treeInfo)
  }

  handleDHTBootstrap (chunk) {
    this.core.dht.handleBootstrap({
      label: this.readTreeLabel(chunk)
    })
  }

  handleDHTBootstrapAck (chunk) {
    const [length, start] = this.readVarInt(chunk)
    this.core.dht.handleBootstrapAck({
      bootstrap: this.readTreeLabel(chunk.slice(start, start + length)),
      response: this.readDHTSetupToken(chunk.slice(start + length))
    })
  }

  handleDHTSetup (chunk) {
    this.core.dht.handleSetup({
      sig: chunk.subarray(0, 64),
      seq: chunk.readBigUInt64BE(64),
      token: this.readDHTSetupToken(chunk.subarray(72))
    })
  }

  readVarInt (buf) {
    let res = 0n
    let i = 0
    while (i < buf.length) {
      res += BigInt(buf[i] & 0x7F) * (1n << BigInt(i * 7))
      if (buf[i++] < 0x80) break
    }
    return [res, i]
  }

  readPeerPort (buf) {
    const res = [0n]
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0) break
      res[res.length - 1] += BigInt(buf[i] & 0x7F) * (1n << BigInt(i * 7))
      if (buf[i] < 0x80) res.push(0n)
    }
    return res
  }

  readTreeLabel (buf) {
    return {
      sig: buf.subarray(0, 64),
      key: buf.subarray(64, 96),
      root: buf.subarray(96, 128),
      seq: buf.readBigUInt64BE(128),
      path: this.readPeerPort(buf.subarray(136))
    }
  }

  readDHTSetupToken (buf) {
    return {
      sig: buf.subarray(0, 64), // Signed by dest
      source: buf.subarray(64, 96), // Who the dest permits a path from
      dest: this.readTreeLabel(buf.subarray(96)) // Path to dest
    }
  }

  readPathNotify (buf) {
    return {
      sig: buf.subarray(0, 64), // TODO? remove this? is it really useful for anything?...
      dest: buf.subarray(64, 96), // Who to send the notify to
      label: this.readTreeLabel(buf.subarray(96))
    }
  }

  handleDHTTeardown (chunk) {
    this.core.dht.handleTeardown({
      sig: chunk.readBigUInt64BE(0),
      key: chunk.subarray(8, 40),
      root: chunk.subarray(40, 72),
      rootSeq: chunk.readBigUInt64BE(72)
    })
  }

  handlePathNotify (chunk) {
    this.core.dht.handlePathNotify(this.readPathNotify(chunk))
  }

  handlePathLookup (chunk) {
    const [length, start] = this.readVarInt(chunk)
    this.core.dht.handlePathLookup({
      notify: this.readPathNotify(chunk.slice(start, start + length)),
      rpath: this.readPeerPort(chunk.slice(start + length))
    })
  }

  handlePathResponse (chunk) {
    const i = chunk.indexOf(0, 32)
    this.core.dht.handlePathResponse({
      // TODO? Needs sign
      from: chunk.subarray(0, 32),
      path: this.readPeerPort(chunk.subarray(32, i)),
      rpath: this.readPeerPort(chunk.subarray(i)).concat(this.peer.port)
    })
  }

  readDHTTraffic (buf) {
    return {
      source: buf.subarray(0, 32),
      dest: buf.subarray(32, 64),
      kind: buf[64],
      payload: buf.subarray(65)
    }
  }

  handleDHTTraffic (chunk) {
    this.core.dht.handleDHTTraffic(this.readDHTTraffic(chunk))
  }

  handlePathTraffic (chunk) {
    const i = chunk.indexOf(0)
    this.core.dht.handlePathTraffic({
      path: this.readPeerPort(chunk.subarray(0, i)),
      dt: this.readDHTTraffic(chunk.subarray(i))
    })
  }

  _transform (chunk, _, cb) {
    switch (chunk[0]) {
      case packetTypeEnum.wireDummy:
        break // Unused
      case packetTypeEnum.wireProtoTree:
        this.handleTreeInfo(chunk.subarray(1))
        break
      case packetTypeEnum.wireProtoDHTBootstrap:
        this.handleDHTBootstrap(chunk.subarray(1))
        break
      case packetTypeEnum.wireProtoDHTBootstrapAck:
        this.handleDHTBootstrapAck(chunk.subarray(1))
        break
      case packetTypeEnum.wireProtoDHTSetup:
        this.handleDHTSetup(chunk.subarray(1))
        break
      case packetTypeEnum.wireProtoDHTTeardown:
        this.handleDHTTeardown(chunk.subarray(1))
        break
      case packetTypeEnum.wireProtoPathNotify:
        this.handlePathNotify(chunk.subarray(1))
        break
      case packetTypeEnum.wireProtoPathLookup:
        this.handlePathLookup(chunk.subarray(1))
        break
      case packetTypeEnum.wireProtoPathResponse:
        this.handlePathResponse(chunk.subarray(1))
        break
      case packetTypeEnum.wireDHTTraffic:
        this.handleDHTTraffic(chunk.subarray(1))
        break
      case packetTypeEnum.wirePathTraffic:
        this.handlePathTraffic(chunk.subarray(1))
        break
    }
    return cb()
  }
}
module.exports.RecieverMiddleware = RecieverMiddleware
