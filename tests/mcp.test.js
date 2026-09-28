import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const base = await mkdtemp(path.join(tmpdir(), 'stillworks-mcp-'))
process.env.STILLWORKS_DATA_DIR = path.join(base, 'data')
process.env.LOVABLE_DATA_DIR = path.join(base, 'data')
await mkdir(path.join(base, 'data'), { recursive: true })

const { addServer, startServer, stopServer, removeServer, aggregatedTools, executeMcpTool } =
  await import('../server/mcp/manager.js')
const { resolveProvider, providerReady } = await import('../server/llm/index.js')

const servers = []
const httpStubs = []

async function registerStubServer() {
  const cfg = await addServer({
    name: 'stubfs',
    transport: 'stdio',
    command: process.execPath,
    args: [path.join(here, 'fixtures', 'stub-mcp-server.mjs')],
  })
  servers.push(cfg.id)
  return cfg
}

after(async () => {
  for (const id of servers) await stopServer(id).catch(() => {})
  for (const s of httpStubs) await new Promise((r) => s.close(r))
  await rm(base, { recursive: true, force: true }).catch(() => {})
})

test('a stdio MCP server actually starts and lists its tools', async () => {
  const cfg = await registerStubServer()
  const started = await startServer(cfg.id)
  // Before the fix, the transport was never spawned and initialize timed out.
  assert.equal(started.running, true)
  assert.equal(started.toolCount, 1)
  const result = await executeMcpTool('mcp__stubfs__list_dir', { dir: 'src' })
  assert.match(result, /entries of src/)
})

test('aggregated tools carry input_schema and a provider-safe name', async () => {
  const tools = aggregatedTools()
  const tool = tools.find((t) => t.name === 'mcp__stubfs__list_dir')
  assert.ok(tool, 'the MCP tool must be offered to the model')
  // Both LLM adapters read input_schema; a missing schema is a hard 400 on
  // Anthropic and a schema-less tool elsewhere.
  assert.deepEqual(tool.input_schema, {
    type: 'object', properties: { dir: { type: 'string' } }, required: ['dir'],
  })
  assert.ok(tool.name.length <= 64, 'OpenAI rejects function names longer than 64 chars')
})

test('an MCP tool error surfaces as tool text, not a crash', async () => {
  const out = await executeMcpTool('mcp__stubfs__list_dir', { dir: 'boom' })
  assert.match(out, /the directory exploded/)
})

/* ---------------- streamable HTTP and the legacy SSE fallback ---------------- */

function reply(req, handlers) {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => handlers.onMessage(JSON.parse(body || '{}')))
}

test('a streamable HTTP MCP server works over one endpoint', async () => {
  const seenHeaders = []
  const stub = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); return res.end() }
    seenHeaders.push(req.headers['mcp-session-id'] || null)
    reply(req, {
      onMessage: (msg) => {
        let result
        if (msg.method === 'initialize') result = { serverInfo: { name: 'http-stub' } }
        else if (msg.method === 'tools/list') result = { tools: [{
          name: 'fetch_thing', description: 'Fetch',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        }] }
        else if (msg.method === 'tools/call') result = { content: [{ type: 'text', text: `got:${msg.params?.arguments?.id}` }] }
        else result = {}
        res.writeHead(200, {
          'content-type': 'application/json',
          ...(msg.method === 'initialize' ? { 'mcp-session-id': 'sess-1' } : {}),
        })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
      },
    })
  })
  httpStubs.push(stub)
  await new Promise((r) => stub.listen(0, '127.0.0.1', r))

  const cfg = await addServer({ name: 'httpstub', transport: 'http', url: `http://127.0.0.1:${stub.address().port}/mcp` })
  servers.push(cfg.id)
  const started = await startServer(cfg.id)
  assert.equal(started.toolCount, 1)
  const out = await executeMcpTool('mcp__httpstub__fetch_thing', { id: 'abc' })
  assert.match(out, /got:abc/)
  assert.equal(seenHeaders[0], null, 'initialize carries no session header yet')
  assert.equal(seenHeaders.at(-1), 'sess-1', 'the session id must be replayed on later calls')
})

test('a legacy HTTP+SSE server is reached through the fallback', async () => {
  let sseStream = null
  const stub = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      sseStream = res
      res.write(`data: ${JSON.stringify({ sessionId: 'legacy-1' })}\n\n`)
      return
    }
    if (req.method === 'POST' && url.pathname === '/message') {
      reply(req, {
        onMessage: (msg) => {
          res.writeHead(202)
          res.end()
          let result
          if (msg.method === 'initialize') result = { serverInfo: { name: 'legacy-stub' } }
          else if (msg.method === 'tools/list') result = { tools: [{
            name: 'old_tool', description: 'Old',
            inputSchema: { type: 'object', properties: {} },
          }] }
          else if (msg.method === 'tools/call') result = { content: [{ type: 'text', text: 'legacy-ok' }] }
          else result = {}
          sseStream?.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`)
        },
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  httpStubs.push(stub)
  await new Promise((r) => stub.listen(0, '127.0.0.1', r))

  const cfg = await addServer({ name: 'legacystub', transport: 'http', url: `http://127.0.0.1:${stub.address().port}` })
  servers.push(cfg.id)
  const started = await startServer(cfg.id)
  assert.equal(started.toolCount, 1)
  assert.match(await executeMcpTool('mcp__legacystub__old_tool', {}), /legacy-ok/)
})

/* ------------------------- provider aliasing ------------------------- */

test('the pollinations default provider resolves to the OpenAI-compatible adapter', async () => {
  assert.equal(resolveProvider({ provider: 'pollinations' }), 'openai')
  assert.equal(
    providerReady({ provider: 'pollinations', openai: { apiKey: 'k' } }, 'pollinations'),
    true,
    'the key lives in the openai block, so a fresh install is ready once a key is set',
  )
  assert.equal(providerReady({ provider: 'pollinations', openai: {} }, 'pollinations'), false)
})

/* ---------------- the whole loop: model → MCP tool → model ---------------- */

test('an agent turn can call an MCP tool and sees its result', async () => {
  const requests = []
  const llm = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      requests.push(JSON.parse(body))
      const first = requests.length === 1
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      if (first) {
        const fn = 'mcp__stubfs__list_dir'
        const args = JSON.stringify({ dir: 'src' })
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: fn, arguments: args } }] } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`)
      } else {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: 'done' } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
      }
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: null }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  httpStubs.push(llm)
  await new Promise((r) => llm.listen(0, '127.0.0.1', r))

  const { createProject } = await import('../server/registry.js')
  const { runAgentTurn } = await import('../server/agent.js')
  const project = await createProject({ name: 'mcp-loop', template: 'react-vite' })
  await writeFile(path.join(project.path, 'src', 'App.tsx'), 'export default function App() { return null }\n')

  const settings = {
    provider: 'openai',
    openai: { apiKey: 'k', baseUrl: `http://127.0.0.1:${llm.address().port}/v1`, model: 'stub' },
    agent: { maxSteps: 4, autoInstall: false, autoCommit: false },
  }
  const result = await runAgentTurn({
    project, userMessage: 'call the mcp tool', settings, mode: 'agent', provider: 'openai',
  })

  assert.equal(result.error ?? null, null)
  assert.equal(result.steps, 2)
  // The model was offered the MCP tool with a usable schema…
  const offered = requests[0].tools.find((t) => t.function.name === 'mcp__stubfs__list_dir')
  assert.ok(offered, 'the MCP tool must be offered to the model')
  assert.deepEqual(offered.function.parameters, {
    type: 'object', properties: { dir: { type: 'string' } }, required: ['dir'],
  })
  // …and its result was delivered back as a tool message.
  const toolMessage = requests[1].messages.find((m) => m.role === 'tool')
  assert.ok(toolMessage, 'the tool result must return to the model')
  assert.match(toolMessage.content, /entries of src/)
})
