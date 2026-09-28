/* Stub MCP stdio server used by tests/mcp.test.js.
 * Speaks just enough JSON-RPC over stdio: initialize, tools/list, tools/call. */
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => {
  buf += c
  let i
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.id === undefined) continue
    let result
    if (msg.method === 'initialize') result = { serverInfo: { name: 'stub', version: '1' } }
    else if (msg.method === 'tools/list') result = { tools: [{
      name: 'list_dir', description: 'List a directory', inputSchema: {
        type: 'object', properties: { dir: { type: 'string' } }, required: ['dir'],
      },
    }] }
    else if (msg.method === 'tools/call') {
      result = msg.params?.arguments?.dir === 'boom'
        ? { isError: true, content: [{ type: 'text', text: 'the directory exploded' }] }
        : { content: [{ type: 'text', text: `entries of ${msg.params?.arguments?.dir}: one, two` }] }
    }
    else result = {}
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n')
  }
})
