const { isMainThread } = require('worker_threads')

const PEERINGS = {
  0: { // 0 to 1, 4
    1: { // 1 to 2, 3
      2: {},
      3: {}
    },
    4: { // 4 to 3
      3: {}
    }
  },
  5: { // 5 to 2
    2: {}
  }
}

function printRecurvise (obj, prefix = '') {
  let str = ''
  const leaves = Object.entries(obj)
  for (let i = 0; i < leaves.length; i++) {
    const isLast = i === (leaves.length - 1)
    str += prefix + (isLast ? '└' : '├') + '── '
    const [name, value] = leaves[i]
    str += name + '\n'
    str += printRecurvise(value, prefix + (isLast ? '   ' : '|  '))
  }
  return str
}

function printTree (results) {
  const tree = {}
  for (const path of results) {
    let cur = tree
    for (const el of path) {
      if (!(el in cur)) cur[el] = {}
      cur = cur[el]
    }
  }
  return printRecurvise(tree)
}

function flattenPeeringTree (tree) {
  const flatten = {}
  for (const i in tree) {
    flatten[i] = [ ...(flatten[i] ?? []), ...Object.keys(tree[i]) ]
    const tmp = flattenPeeringTree(tree[i])
    for (const b in tmp) {
      flatten[b] = [ ...(flatten[b] ?? []), ...tmp[b] ]
    }
  }
  return flatten
}

function reversePeeringTree (tree) {
  const reversed = {}
  for (const i in tree) {
    for (const b of tree[i]) {
      if (!(b in reversed)) reversed[b] = []
      reversed[b].push(i)
    }
  }
  return reversed
}

async function main () {
  const { once } = require('events')
  const readline = require('readline')
  const { Worker } = require('worker_threads')
  const { scheduler } = require('timers/promises')

  const peers = []
  const tree = flattenPeeringTree(PEERINGS)
  const rev = reversePeeringTree(tree)
  for (const id in tree) {
    peers[id] = new Worker(__filename, {
      workerData: {
        Listen: [`unix://tmp/yggdrasil${id}`],
        Peers: [...tree[id], ...(rev[id] ?? [])].map(v => `unix://tmp/yggdrasil${v}`)
      }
    })
    peers[id].execute = async function (data) {
      peers[id].postMessage(data)
      return await once(peers[id], 'message')
    }
  }
  let lastChar = ''
  let skipWait = false
  readline.emitKeypressEvents(process.stdin)
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.on('keypress', char => {
    lastChar = char
    skipWait = true
  })
  while (true) {
    console.clear()
    console.log('YggdrasilJS example')
    console.log('')
    switch (lastChar.toLowerCase()) {
      case 't': {
        const p = await Promise.all(
          peers.map(v => v.execute({ type: 'tree' }))
        )
        console.log('DHT')
        console.log(printTree(p.flat(1)))
        break
      }
      case 'p': {
        const p = await Promise.all(
          peers.map(v => v.execute({ type: 'peers' }))
        )
        console.log('Peerings')
        console.log(printRecurvise(Object.assign(...p.flat(1))))
        break
      }
      case 'x': {
        console.log('Exiting')
        process.exit()
      }
      default: {
        console.log(`Peers: ${peers.length}`)
      }
    }
    console.log('')
    console.log('== Controls ==')
    console.log('- [t] Show DHT tree')
    console.log('- [p] Show peerings')
    console.log('- [x] Exit')
    console.log('- [ ] Status')
    if (skipWait) {
      skipWait = false
    } else {
      await scheduler.wait(1000)
    }
  }
}

async function worker () {
  const Yggdrasil = require('../src')
  const Config = require('../src/utils/config')
  const { workerData, parentPort } = require('worker_threads')

  const config = await Config.generate()
  Object.assign(config, workerData)  
  globalThis.ygg = new Yggdrasil(config)

  parentPort.on('message',
    (command) => execute(ygg, command)
      .then(v => parentPort.postMessage(v))
  )
}

async function execute (inst, { type, params = [] }) {
  const listening = () => Array.from(inst.peers.listeners.keys(), v => v.toString())[0]
  switch (type) {
    case 'tree': return [
      inst.dht.selfTreeInfo.root.toString().slice(0, 8)
      + ' #seq '
      + inst.dht.selfTreeInfo.seq,
      ...inst.dht.selfTreeInfo.hops.map(v => (
        v.nextPeer.toString().slice(0, 8)
        + ' #port '
        + v.localPort
      )),
      listening() + ' @ ' + new Date(inst.dht.selfTreeInfo.time).toLocaleTimeString()
    ]
    case 'peers': return {
      [listening()]: Object.fromEntries(
        Array.from(inst.peers.peers.keys(), v => v.toString()).map(v => ([v, {}]))
      )
    }
  }
}

if (isMainThread) {
	main()
} else {
	worker()
}
