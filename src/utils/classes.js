const { ed25519, PublicKey } = require('../utils/crypto')
const { Unsigned } = require('../net/serialization')

class TreeInfo {
  static PACKET_TYPE = 'Tree'

  constructor ({ root, seq = BigInt(Date.now()), hops = [], hseq = 0n, time = Date.now() }) {
    this.root = PublicKey.from(root)
    this.seq = seq.valueOf()
    this.hops = hops.map(v => TreeInfoHop.from(v))
    this.hseq = hseq.valueOf()
    this.time = time
  }

  hopFrom () {
    return this.hops[this.hops.length - 2]?.nextPeer ?? this.root
  }

  hopDest () {
    return this.hops[this.hops.length - 1]?.nextPeer ?? null
  }

  distanceToLabel (label, offset = 0) {
    if (!this.root.equal(label.root)) {
      return Number.MAX_SAFE_INTEGER
    }
    let a = this.hops.length + offset
    let b = label.path.length
    if (b < a) {
      [a, b] = [b, a] // make 'a' be the smaller value
    }
    let lcaIdx = -1 // last common ancestor
    for (let idx = 0; idx < a; idx++) {
      if (this.hops[idx].port !== label.path[idx]) {
        break
      }
      lcaIdx = idx
    }
    return a + b - 2 * (lcaIdx + 1)
  }

  isLoopSafe () {
    let key = this.root
    const keys = new Set()
    for (const hop of this.hops) {
      if (keys.has(key)) {
        return false
      }
      keys.add(key)
      key = hop.next
    }
    return !keys.has(key)
  }

  toBuffer () {
    return {
      root: this.root.toBuffer(),
      seq: this.seq,
      hops: this.hops.map(v => v.toBuffer())
    }
  }

  async toBufferSigned (peer, privateKey) {
    const data = this.toBuffer()
    const hop = new TreeInfoHop({
      next: peer.remoteKey,
      port: peer.link
    })
    const index = data.hops.push(hop.toBuffer()) - 1
    await hop._sign(data, privateKey)
    data.hops[index] = hop.toBuffer()
    return data
  }

  async verifySignatures () {
    const buf = Unsigned.createPacketBuffer('treeInfo', this.toBuffer())
    let b = Unsigned.sizeOf({
      root: this.root.toBuffer(),
      seq: this.seq,
      hops: []
    }, 'treeInfo')
    for (let i = 0; i < this.hops.length; i++) {
      b += Unsigned.sizeOf(this.hops[i].toBuffer(), 'treeHop')
      if (!await ed25519.verify(
        this.hops[i].signature,
        buf.subarray(0, b),
        (i ? this.hops[i - 1].nextPeer : this.root).toBuffer()
      )) return false
    }
    return true
  }

  static from (info) {
    return info instanceof TreeInfo ? info : new TreeInfo(info)
  }
}

class TreeInfoHop {
  constructor ({ next, port = 0, sign = null }) {
    this.nextPeer = PublicKey.from(next)
    this.localPort = port
    this.signature = sign
  }

  toBuffer () {
    return {
      next: this.nextPeer.toBuffer(),
      port: this.localPort,
      sign: this.signature
    }
  }

  async _sign (treeInfoSerialized, privateKey) {
    this.signature = await privateKey.sign(
      Unsigned.createPacketBuffer('treeInfo', treeInfoSerialized)
    )
  }

  static from (hop) {
    return hop instanceof TreeInfoHop ? hop : new TreeInfoHop(hop)
  }
}

class TreeExpiredInfo {
  constructor ({ seq = 0n, time = Date.now() }) {
    this.seq = seq
    this.time = time
  }

  toBuffer () {
    return {
      seq: this.seq,
      time: this.time
    }
  }

  static from (exp) {
    return exp instanceof TreeExpiredInfo ? exp : new TreeExpiredInfo(exp)
  }
}

class TreeLabel {
  constructor ({ sign = null, key, root, seq = 0n, path = [] }) {
    this.signature = sign
    this.key = PublicKey.from(key)
    this.root = PublicKey.from(root)
    this.seq = seq.valueOf()
    this.path = path
  }

  async verify () {
    return this.verifySignatures()
  }

  async verifySignatures () {
    const buf = Unsigned.createPacketBuffer('treeLabel', this.toBuffer())
    return ed25519.verify(this.signature, buf, this.key.toBuffer())
  }

  async sign (privateKey) {
    this.signature = await privateKey.sign(
      Unsigned.createPacketBuffer('treeLabel', this.toBuffer())
    )
  }

  toBuffer () {
    return {
      sign: this.signature,
      key: this.key.toBuffer(),
      root: this.root.toBuffer(),
      seq: this.seq,
      path: this.path
    }
  }

  static from (label) {
    return label instanceof TreeLabel ? label : new TreeLabel(label)
  }
}

class SetupToken {
  constructor ({ source, destination, sign = null }) {
    this.sourceKey = PublicKey.from(source)
    this.destLabel = TreeLabel.from(destination)
    this.signature = sign
  }

  toBuffer () {
    return {
      source: this.sourceKey.toBuffer(),
      destination: this.destLabel.toBuffer(),
      sign: this.signature
    }
  }

  async verify () {
    return (await this.verifySignatures()) && (await this.destLabel.verify())
  }

  async verifySignatures () {
    const buf = Unsigned.createPacketBuffer('setupToken', this.toBuffer())
    return ed25519.verify(this.signature, buf, this.sourceKey.toBuffer())
  }

  async sign (privateKey) {
    this.signature = await privateKey.sign(
      Unsigned.createPacketBuffer('setupToken', this.toBuffer())
    )
  }

  static from (token) {
    return token instanceof SetupToken ? token : new SetupToken(token)
  }
}

class Bootstrap extends TreeLabel {
  static PACKET_TYPE = 'Bootstrap'
}

class BootstrapAck {
  static PACKET_TYPE = 'BootstrapAck'

  constructor ({ bootstrap, response }) {
    this.request = Bootstrap.from(bootstrap)
    this.response = SetupToken.from(response)
  }

  async verify () {
    return (await this.request.verify()) && (await this.response.verify())
  }

  toBuffer () {
    return {
      bootstrap: this.request.toBuffer(),
      response: this.response.toBuffer()
    }
  }

  static from (ack) {
    return ack instanceof BootstrapAck ? ack : new BootstrapAck(ack)
  }
}

class SetupRequest {
  static PACKET_TYPE = 'Setup'
  constructor ({ seq = 0n, token, sign = null }) {
    this.seq = seq.valueOf()
    this.setup = SetupToken.from(token)
    this.signature = sign
  }

  toBuffer () {
    return {
      sign: this.signature,
      seq: this.seq,
      token: this.setup.toBuffer(),
    }
  }

  async verify () {
    return (await this.verifySignatures()) && (await this.setup.verify())
  }

  async verifySignatures () {
    const buf = Unsigned.createPacketBuffer('setup', this.toBuffer())
    return ed25519.verify(this.signature, buf, this.sourceKey.toBuffer())
  }

  async sign (privateKey) {
    this.signature = await privateKey.sign(
      Unsigned.createPacketBuffer('setup', this.toBuffer())
    )
  }

  static from (token) {
    return token instanceof SetupRequest ? token : new SetupRequest(token)
  }
}

module.exports = {
  TreeInfo,
  TreeInfoHop,
  TreeExpiredInfo,
  Bootstrap,
  BootstrapAck,
  TreeLabel,
  SetupToken,
  SetupRequest
}
