/* Model Context Protocol — zero-dependency client that speaks JSON-RPC 2.0
 * over stdio (local npx/uvx/node/python/deno/bun servers) or Streamable HTTP
 * (remote endpoints), with the legacy HTTP+SSE handshake as a fallback. */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { childEnv, PRODUCT_ID, APP_VERSION } from '../config.js'

const REQUEST_TIMEOUT = 30_000
// The first `initialize` may sit behind an `npx -y <pkg>` cold download, which
// regularly takes longer than a plain request.
const INIT_REQUEST_TIMEOUT = 90_000
const INIT_TIMEOUT = 15_000

/** Sanitise a tool name so it is safe as an agent tool identifier. */
export function sanitiseToolName(name) {
  return String(name || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unnamed_tool'
}

/* ------------------------------------------------------------------ stdio */

class StdioTransport {
  constructor(command, args = [], env = {}, cwd) {
    this.command = command
    this.args = args
    this.env = env
    this.cwd = cwd
    this.child = null
    this._pending = new Map()
    this._id = 0
    this._buffer = ''
    this._closed = false
    this.onError = () => {}
    this.onNotification = () => {}
  }

  async start() {
    const cmd = resolveCommand(this.command)
    this.child = spawn(cmd, this.args, {
      // A connector sees the platform's allowlist plus its own env block, never
      // the credentials this process happens to hold.
      env: childEnv(this.env),
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => this._onStdout(chunk))
    this.child.stderr.on('data', (chunk) => console.error(`[mcp:${this.command}] ${chunk}`))
    this.child.on('error', (err) => {
      const failure = new Error(`Could not start "${this.command}": ${err.message}`)
      this.onError(failure)
      for (const [, { reject }] of this._pending) reject(failure)
      this._pending.clear()
    })
    this.child.on('exit', (code, signal) => {
      if (!this._closed) {
        this._closed = true
        this.onError(new Error(`${this.command} exited ${signal || code}`))
        // Reject all pending requests.
        for (const [, { reject }] of this._pending) {
          reject(new Error(`Server ${this.command} exited (${signal || code})`))
        }
        this._pending.clear()
      }
    })

    // Wait until the child is actually ready to receive data.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.command} did not start in time`)), INIT_TIMEOUT)
      this.child.once('spawn', () => { clearTimeout(timer); resolve() })
      // Some platforms never emit 'spawn'; fall back to next tick.
      setImmediate(() => { clearTimeout(timer); resolve() })
    })
  }

  async request(method, params, timeoutMs = REQUEST_TIMEOUT) {
    const id = ++this._id
    const msg = { jsonrpc: '2.0', id, method, params }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id)
        reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this._pending.set(id, { resolve, reject, timer })
      this._write(msg)
    })
  }

  notify(method, params) {
    this._write({ jsonrpc: '2.0', method, params })
  }

  async stop() {
    this._closed = true
    for (const [, { timer }] of this._pending) clearTimeout(timer)
    this._pending.clear()
    if (this.child && !this.child.killed) {
      this.child.kill()
      await new Promise((r) => this.child.once('exit', r)).catch(() => {})
    }
  }

  _write(obj) {
    if (this.child?.stdin?.writable) {
      this.child.stdin.write(JSON.stringify(obj) + '\n')
    }
  }

  _onStdout(chunk) {
    this._buffer += chunk
    let idx
    while ((idx = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.slice(0, idx).trim()
      this._buffer = this._buffer.slice(idx + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        if (msg.id !== undefined) {
          const entry = this._pending.get(msg.id)
          if (entry) {
            clearTimeout(entry.timer)
            this._pending.delete(msg.id)
            if (msg.error) entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
            else entry.resolve(msg.result)
          }
        } else {
          this.onNotification(msg)
        }
      } catch { /* ignore malformed lines */ }
    }
  }
}

/* --------------------------------------------------------------- http/sse */

/**
 * Remote MCP servers. Speaks the current Streamable HTTP protocol (POST
 * JSON-RPC directly to the configured URL; the session rides in the
 * `Mcp-Session-Id` header) and falls back to the legacy HTTP+SSE handshake
 * (GET /sse, then POST /message?sessionId=…) when the endpoint has no POST
 * route — older servers answer 404/405/501 there.
 */
class HttpSseTransport {
  constructor(url, headers = {}) {
    this.baseUrl = url.replace(/\/+$/, '')
    this.headers = headers
    this.sessionId = null
    this.mode = 'streamable'
    this._id = 0
    this._legacy = null
    this._closed = false
    this.onError = () => {}
    this.onNotification = () => {}
  }

  async start() {
    // Streamable HTTP needs no handshake: the first POST is the initialize.
    // Legacy fallback happens lazily, inside request(), if that POST is refused.
  }

  async request(method, params, timeoutMs = REQUEST_TIMEOUT) {
    const msg = { jsonrpc: '2.0', id: ++this._id, method, params }

    if (this.mode === 'legacy') return this._legacyRequest(msg, timeoutMs)

    let response
    try {
      response = await this._post(msg, timeoutMs)
    } catch (err) {
      if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
        throw new Error(`Request ${method} timed out after ${timeoutMs}ms`)
      }
      throw err
    }

    if ([404, 405, 501].includes(response.status)) {
      await this._startLegacy()
      return this._legacyRequest(msg, timeoutMs)
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`MCP endpoint ${this.baseUrl} answered ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
    }

    const sid = response.headers.get('mcp-session-id')
    if (sid) this.sessionId = sid
    return this._readReply(response, msg.id)
  }

  async notify(method, params) {
    const msg = { jsonrpc: '2.0', method, params }
    if (this.mode === 'legacy') {
      const url = this.sessionId
        ? `${this.baseUrl}/message?sessionId=${encodeURIComponent(this.sessionId)}`
        : `${this.baseUrl}/message`
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.headers },
        body: JSON.stringify(msg),
      }).catch(() => {})
      return
    }
    try {
      await this._post(msg, REQUEST_TIMEOUT)
    } catch { /* notifications are fire-and-forget */ }
  }

  async stop() {
    this._closed = true
    if (this.mode === 'streamable' && this.sessionId) {
      fetch(this.baseUrl, {
        method: 'DELETE',
        headers: { 'mcp-session-id': this.sessionId, ...this.headers },
      }).catch(() => {})
    }
    if (this._legacy) {
      try { await this._legacy.reader.cancel() } catch { /* ignore */ }
      this._legacy.pending.clear()
    }
  }

  /* ---------------------------- streamable HTTP ---------------------------- */

  async _post(msg, timeoutMs) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      ...this.headers,
    }
    return fetch(this.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  /** A reply is either a bare JSON-RPC body or an SSE stream of events. */
  async _readReply(response, id) {
    const ctype = response.headers.get('content-type') || ''
    if (ctype.includes('text/event-stream')) {
      return this._readSseReply(response, id)
    }
    const text = await response.text()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`MCP endpoint returned a non-JSON reply: ${text.slice(0, 200)}`)
    }
    if (parsed.error) throw new Error(parsed.error.message || JSON.stringify(parsed.error))
    return parsed.result ?? parsed
  }

  async _readSseReply(response, id) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const msg = parseSseBlock(block)
          if (!msg) continue
          if (msg.id !== undefined) {
            if (msg.id !== id) continue
            if (msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error))
            return msg.result
          }
          if (msg.method) this.onNotification(msg)
        }
      }
    } finally {
      try { await reader.cancel() } catch { /* ignore */ }
    }
    throw new Error('The MCP endpoint closed the SSE stream without answering.')
  }

  /* ------------------------------ legacy HTTP+SSE ------------------------------ */

  async _startLegacy() {
    const response = await fetch(`${this.baseUrl}/sse`, {
      headers: this.headers,
      signal: AbortSignal.timeout(INIT_TIMEOUT),
    })
    if (!response.ok) {
      throw new Error(
        `MCP endpoint ${this.baseUrl} speaks neither Streamable HTTP nor the legacy SSE protocol ` +
        `(GET /sse answered ${response.status}).`,
      )
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    this._legacy = { reader, decoder, pending: new Map() }
    this.mode = 'legacy'

    let buffer = ''
    const pump = async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let boundary
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const msg = parseSseBlock(block)
            if (!msg) continue
            if (msg.sessionId || msg.session_id) {
              this.sessionId = msg.sessionId || msg.session_id
              continue
            }
            if (msg.method && msg.id === undefined) this.onNotification(msg)
            else if (msg.id !== undefined) this._resolveLegacy(msg)
          }
        }
        if (!this._closed) this.onError(new Error('The MCP SSE stream closed.'))
      } catch (err) {
        if (!this._closed) this.onError(err)
      }
    }
    void pump()

    // The session id must arrive before anything else can be sent.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SSE session-id timeout')), INIT_TIMEOUT)
      const check = () => {
        if (this.sessionId) { clearTimeout(timer); resolve() }
        else setTimeout(check, 50)
      }
      check()
    })
  }

  _resolveLegacy(msg) {
    const entry = this._legacy?.pending.get(msg.id)
    if (!entry) return
    this._legacy.pending.delete(msg.id)
    clearTimeout(entry.timer)
    if (msg.error) entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
    else entry.resolve(msg.result)
  }

  _legacyRequest(msg, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._legacy?.pending.delete(msg.id)
        reject(new Error(`Request ${msg.method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this._legacy.pending.set(msg.id, { resolve, reject, timer })
      const url = this.sessionId
        ? `${this.baseUrl}/message?sessionId=${encodeURIComponent(this.sessionId)}`
        : `${this.baseUrl}/message`
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.headers },
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(timeoutMs),
      }).then(async (response) => {
        // Legacy servers answer 202 and deliver the real reply over the SSE
        // stream; some answer inline.
        if (response.status === 202) return
        const text = await response.text().catch(() => '')
        if (!text) return
        try {
          this._resolveLegacy(JSON.parse(text))
        } catch { /* non-JSON body: the SSE stream carries the reply */ }
      }).catch((err) => {
        clearTimeout(timer)
        this._legacy?.pending.delete(msg.id)
        reject(err)
      })
    })
  }
}

/** One SSE `data:` block → parsed JSON payload, or null. */
function parseSseBlock(block) {
  const data = block
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).replace(/^ /, ''))
    .join('\n')
  if (!data) return null
  try { return JSON.parse(data) } catch { return null }
}

/* ---------------------------------------------------------------- factory */

/**
 * Create an MCP client for the given config.
 *
 * Config shape:
 *   { transport: 'stdio', command, args?, env?, cwd? }
 *   { transport: 'http' | 'sse', url, headers? }
 */
export function createMcpClient(config) {
  if (config.transport === 'stdio') {
    return new StdioClient(new StdioTransport(config.command, config.args, config.env, config.cwd))
  }
  return new HttpClient(new HttpSseTransport(config.url, config.headers))
}

/* ------------------------------------------------------- shared client API */

class StdioClient {
  #t
  #ready = false
  #serverInfo = null
  #tools = []

  constructor(transport) {
    this.#t = transport
    transport.onError = (err) => { if (this.#ready) this.#ready = false }
    transport.onNotification = (msg) => this.#onNotify(msg)
  }

  get ready() { return this.#ready }
  get serverInfo() { return this.#serverInfo }
  get tools() { return this.#tools }

  async initialize() {
    await this.#t.start()
    const result = await this.#t.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { roots: { listChanged: false } },
      clientInfo: { name: PRODUCT_ID, version: APP_VERSION },
    }, INIT_REQUEST_TIMEOUT)
    this.#serverInfo = result
    this.#t.notify('notifications/initialized')
    await this.refreshTools()
    this.#ready = true
  }

  async refreshTools() {
    const result = await this.#t.request('tools/list')
    this.#tools = (result?.tools || []).map((t) => ({
      name: sanitiseToolName(t.name),
      originalName: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }))
  }

  async callTool(name, args) {
    const original = this.#tools.find((t) => t.name === name)?.originalName || name
    const result = await this.#t.request('tools/call', { name: original, arguments: args })
    return formatToolResult(result)
  }

  async stop() { await this.#t.stop() }

  #onNotify(msg) {
    if (msg.method === 'notifications/tools/list_changed') {
      this.refreshTools().catch(() => {})
    }
  }
}

class HttpClient {
  #t
  #ready = false
  #serverInfo = null
  #tools = []

  constructor(transport) {
    this.#t = transport
    transport.onError = (err) => { if (this.#ready) this.#ready = false }
    transport.onNotification = (msg) => this.#onNotify(msg)
  }

  get ready() { return this.#ready }
  get serverInfo() { return this.#serverInfo }
  get tools() { return this.#tools }

  async initialize() {
    await this.#t.start()
    const result = await this.#t.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { roots: { listChanged: false } },
      clientInfo: { name: PRODUCT_ID, version: APP_VERSION },
    }, INIT_REQUEST_TIMEOUT)
    this.#serverInfo = result
    this.#t.notify('notifications/initialized')
    await this.refreshTools()
    this.#ready = true
  }

  async refreshTools() {
    const result = await this.#t.request('tools/list')
    this.#tools = (result?.tools || []).map((t) => ({
      name: sanitiseToolName(t.name),
      originalName: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }))
  }

  async callTool(name, args) {
    const original = this.#tools.find((t) => t.name === name)?.originalName || name
    const result = await this.#t.request('tools/call', { name: original, arguments: args })
    return formatToolResult(result)
  }

  async stop() { await this.#t.stop() }

  #onNotify(msg) {
    if (msg.method === 'notifications/tools/list_changed') {
      this.refreshTools().catch(() => {})
    }
  }
}

/* ---------------------------------------------------------------- helpers */

/** Resolve a command name to an absolute path when possible. */
function resolveCommand(cmd) {
  if (path.isAbsolute(cmd)) return cmd
  // On Windows, npx.cmd etc. need the extension resolved off PATH first.
  if (process.platform === 'win32' && !cmd.includes('.')) {
    const candidates = [`${cmd}.cmd`, `${cmd}.bat`, `${cmd}.exe`, cmd]
    for (const c of candidates) {
      const found = process.env.PATH?.split(path.delimiter)
        .map((d) => path.join(d, c))
        .find((p) => existsSync(p))
      if (found) return found
    }
  }
  return cmd
}

/** Normalise a tools/call response into a string the agent can consume. */
function formatToolResult(result) {
  if (typeof result === 'string') return result
  if (Array.isArray(result?.content)) {
    return result.content
      .map((block) => {
        if (block.type === 'text') return block.text
        if (block.type === 'image') return `[image: ${block.mimeType || 'unknown'}]`
        return JSON.stringify(block)
      })
      .join('\n')
  }
  if (result?.isError) return `ERROR: ${result.error || JSON.stringify(result)}`
  return JSON.stringify(result, null, 2)
}
