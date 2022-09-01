const Yggdrasil = require('./src')
const Config = require('./src/utils/config')

async function main () {
  const config = await Config.generate()
  config.Peers = [
    'tcp://127.0.0.1:13337'
  ]

  const ygg = new Yggdrasil(config)
}

main()
