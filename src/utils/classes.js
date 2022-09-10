const { ed25519, PublicKey } = require('../utils/crypto')
const { Protocol } = require('../net/serialization')

class TreeInfo {
  constructor ({ root, seq = 0n, hops = [], hseq = 0n, time = Date.now() }) {
    this.root = PublicKey.from(root)
    this.seq = seq
    this.hops = hops.map(v => TreeInfoHop.from(v))
    this.hseq = hseq
    this.time = time
  }

  hopFrom () {
    return this.hops[this.hops.length - 2]?.nextPeer ?? this.root
  }

  hopDest () {
    return this.hops[this.hops.length - 1]?.nextPeer ?? null
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
    const buf = Protocol.createPacketBuffer('treeInfoNoSignature', this.toBuffer())
    let b = Protocol.sizeOf({
      root: this.root.toBuffer(),
      seq: this.seq,
      hops: []
    }, 'treeInfoNoSignature')
    for (let i = 0; i < this.hops.length; i++) {
      b += Protocol.sizeOf(this.hops[i].toBuffer(), 'treeHopNoSignature')
      if (!await ed25519.verify(
        this.hops[i].signature,
        buf.subarray(0, b),
        (i ? this.hops[i - 1].nextPeer : this.root).toBuffer()
      )) return false
    }
    return true
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
      Protocol.createPacketBuffer('treeInfoNoSignature', treeInfoSerialized)
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

  from (exp) {
    return exp instanceof TreeExpiredInfo ? exp : new TreeExpiredInfo(exp)
  }
}

class Bootstrap {
  constructor ({ label = null }) {
    this.label = TreeLabel.from(label)
  }

  async verify () {
    return this.label.verify()
  }

  toBuffer () {
    return {
      label: this.label.toBuffer()
    }
  }

  from (bootstrap) {
    return bootstrap instanceof Bootstrap ? bootstrap : new Bootstrap(bootstrap)
  }
}

class TreeLabel {
  constructor ({ sig = null, key, root, seq = 0n, path = [] }) {
    this.signature = sig
    this.key = PublicKey.from(key)
    this.root = PublicKey.from(root)
    this.seq = seq
    this.path = path
  }

  async verify () {
    return this.verifySignatures()
  }

  async verifySignatures () {
    const buf = Protocol.createPacketBuffer('treeLabelNoSignature', this.toBuffer())
    return ed25519.verify(this.signature, buf, this.key.toBuffer())
  }

  async sign (privateKey) {
    this.signature = await privateKey.sign(
      Protocol.createPacketBuffer('treeLabelNoSignature', this.toBuffer())
    )
  }

  toBuffer () {
    return {
      sig: this.signature,
      key: this.key.toBuffer(),
      root: this.root.toBuffer(),
      seq: this.seq,
      path: this.path
    }
  }

  from (label) {
    return label instanceof TreeLabel ? label : new TreeLabel(label)
  }
}

module.exports = {
  TreeInfo,
  TreeInfoHop,
  TreeExpiredInfo,
  Bootstrap,
  TreeLabel
}
