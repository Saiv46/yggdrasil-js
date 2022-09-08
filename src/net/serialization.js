const {
  ProtoDef,
  // Compiler: { ProtoDefCompiler },
  Serializer, FullPacketParser
} = require('protodef')
const definition = require('./protocol.json')

/*const CustomTypes = {
  Read: {
    restarray: ['parametrizable', (compiler, type) => {
      let code = 'const data = []\n'
      code += 'let size = 0\n'
      code += 'for (; offset + size < buffer.length;) {\n'
      code += '  const elem = ' + compiler.callType(type, 'offset + size') + '\n'
      code += '  data.push(elem.value)\n'
      code += '  size += elem.size\n'
      code += '}\n'
      code += 'return { value: data, size }'
      return compiler.wrapCode(code)
    }],
    wrapper: ['parametrizable', (compiler, { countType, type }) => {
      let code = ''
      code += 'const { value: count, size: countSize } = ' + compiler.callType(countType) + '\n'
      code += 'const { value, size } = ' + compiler.callType(type, 'offset + countSize') + '\n'
      code += 'if (size !== count) {\n'
      code += '  throw new PartialReadError("Incorrect wrapped length, found size is " + size + " expected size was " + count)\n'
      code += '}\n'
      code += 'return { value, size: size + countSize }'
      return compiler.wrapCode(code)
    }]
  },
  Write: {
    restarray: ['parametrizable', (compiler, type) => {
      let code = 'for (let i = 0; i < value.length; i++) {\n'
      code += '  offset = ' + compiler.callType('value[i]', type) + '\n'
      code += '}\n'
      code += 'return offset'
      return compiler.wrapCode(code)
    }],
    wrapper: ['parametrizable', (compiler, { countType, type }) => {
      let code = 'const oldOffset = offset'
      code += 'const size = ' + compiler.callType('value', type) + ' - oldOffset\n'
      code += 'offset = ' + compiler.callType('size', countType) + '\n'
      code += 'offset = ' + compiler.callType('value', countType) + '\n'
      code += 'return offset'
      return compiler.wrapCode(code)
    }]
  },
  SizeOf: {
    restarray: ['parametrizable', (compiler, type) => {
      let code = 'let size = 0\n'
      if (!isNaN(compiler.callType('value[i]', type))) {
        code += 'size += value.length * ' + compiler.callType('value[i]', type) + '\n'
      } else {
        code += 'for (let i = 0; i < value.length; i++) {\n'
        code += '  size += ' + compiler.callType('value[i]', type) + '\n'
        code += '}\n'
      }
      code += 'return size'
      return compiler.wrapCode(code)
    }],
    wrapper: ['parametrizable', (compiler, { countType, type }) => {
      let code = 'const size = ' + compiler.callType('value', type) + '\n'
      code += 'return size + ' + compiler.callType('size', countType)
      return compiler.wrapCode(code)
    }]
  }
}*/

const CustomTypes = {
  restarray: [
    function readRestArray (buffer, offset, typeArg, rootNode) {
      const value = []
      let size = 0
      for (; offset + size < buffer.length;) {
        const elem = this.read(buffer, offset + size, typeArg, rootNode)
        value.push(elem.value)
        size += elem.size
      }
      return { value, size }
    },
    function writeRestArray (value, buffer, offset, typeArg, rootNode) {
      for (let i = 0; i < value.length; i++) {
        offset = this.write(value[i], buffer, offset, typeArg, rootNode)
      }
      return offset
    },
    function sizeOfRestArray (value, typeArg, rootNode) {
      let size = 0
      for (let i = 0; i < value.length; i++) {
        size += this.sizeOf(value[i], typeArg, rootNode)
      }
      return size
    }
  ],
  wrapper: [
    function readWrapper (buffer, offset, typeArgs, rootNode) {
      const { value: count, size: countSize } = this.read(buffer, offset, typeArgs.countType, rootNode)
      const { value, size } = this.read(buffer, offset + countType, typeArgs.type, rootNode)
      if (size !== count) {
        throw new PartialReadError("Incorrect wrapped length, found size is " + size + " expected size was " + count)
      }
      return { value, size: size + countSize }
    },
    function writeWrapper (value, buffer, offset, typeArgs, rootNode) {
      const size = this.write(value, buffer, offset, typeArgs.type, rootNode) - offset
      offset = this.write(size, buffer, offset, typeArgs.countType, rootNode)
      offset = this.write(value, buffer, offset, typeArgs.type, rootNode)
      return offset
    },
    function sizeOfWrapper (value, typeArgs, rootNode) {
      const size = this.sizeOf(value, typeArgs.type, rootNode)
      return size + this.sizeOf(size, typeArgs.countType, rootNode)
    }
  ],
  restbuffer: [
    function readRestBuffer (buffer, offset) {
      return { value: buffer.subarray(offset), size: buffer.length - offset }
    },
    function writeRestBuffer (value, buffer, offset) {
      return offset + value.data.copy(buffer, offset)
    },
    function sizeOfRestBuffer (value) {
      return value.length
    }
  ]
}

const proto = new ProtoDef(false)
proto.addTypes(CustomTypes)
proto.addProtocol(definition, ['wire'])
// const compiler = new ProtoDefCompiler()
// const proto = compiler.compileProtoDefSync()

module.exports = {
  createDeserializer: () => new FullPacketParser(proto, 'packet'),
  createSerializer: () => new Serializer(proto, 'packet'),
  Protocol: proto
}
