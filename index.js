const Yggdrasil = require('./src')
const Address = require('./src/utils/address')
const Config = require('./src/utils/config')
const { VERSION } = require('./src/utils/constants')

async function main () {
  const config = await Config.generate()
  config.Peers = ['tcp://127.0.0.1:13337']
  config.Listen = ['tcp://127.0.0.1:9090']

  const ygg = new Yggdrasil(config)
  console.log('Protocol: yggdrasil')
  console.log('Protocol version:', ...VERSION)
  console.log('IPv6 address:', Address.fromPublicKey(ygg.publicKey.toBuffer()).toString())
  console.log('IPv6 subnet:', Address.subnetFromPublicKey(ygg.publicKey.toBuffer()).toString())
  console.log('Public key:', ygg.publicKey.toString())
  console.log('Coords:', [])
}

main()
