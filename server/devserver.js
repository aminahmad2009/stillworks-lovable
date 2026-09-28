import { spawn } from 'node:child_process'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { MAX_RUNNING_SERVERS, childEnv } from './config.js'

const IS_WINDOWS = process.platform === 'win32'
const NPM = IS_WINDOWS ? 'npm.cmd' : 'npm'

const LOG_LIMIT = 400
const START_TIMEOUT = 180_000
const INSTALL_TIMEOUT = 600_000

/**
 * One event stream per project id, plus a global stream for cross-project UI
 * updates. The HTTP layer subscribes and forwards everything as SSE.
 */
export const bus = new EventEmitter()
bus.setMaxListeners(0)

export function emit(projectId, type, payload = {}) {
  bus.emit('event', { projectId, type, at: Date.now(), ...payload })
}

class DevServer {
  constructor(project) {
    this.projectId = project.id
    this.slug = project.slug
    this.dir = project.path
    this.port = project.port
    this.status = 'stopped'
    this.child = null
    this.logs = []
    this.lastError = null
    this.lastReadyAt = null
    this.startedAt = null
    this.lastUsedAt = Date.now()
    this._startTimer = null
  }

  get previewUrl() {
    return `http://127.0.0.1:${this.port}`
  }

  pushLog(stream, text) {
    for (const line of stripAnsi(text).split(/\r?\n/)) {
      if (!line.trim()) continue
      const entry = { stream, line, at: Date.now() }
      this.logs.push(entry)
      if (this.logs.length > LOG_LIMIT) this.logs.shift()
      emit(this.projectId, 'log', { stream, line })
    }
    this.detectState(text)
  }

  /** Read Vite's own output to decide running vs. broken. */
  detectState(rawText) {
    const text = stripAnsi(rawText)
    if (/VITE v[\d.]+\s+ready/i.test(text) || /Local:\s+http:\/\//i.test(text)) {
      if (this.status !== 'running') this.setStatus('running')
      this.lastReadyAt = Date.now()
      this.lastError = null
    }

    // Vite 8 prefixes a clock time, e.g. "11:02:20 PM [vite] Internal server
    // error: Transform failed with 1 error:", so match anywhere in the line.
    const errorMatch = text.match(
      /(Internal server error|Pre-transform error|Transform failed with \d+ error|Failed to resolve import|error when starting dev server)[:\s]?([^\n]*)/i,
    )
    if (errorMatch) {
      this.lastError = `${errorMatch[1]}: ${errorMatch[2] || ''}`.trim().slice(0, 4000)
      this.setStatus('error')
      return
    }

    if (/Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|ELIFECYCLE/i.test(text)) {
      this.lastError = text.slice(0, 4000)
      this.setStatus('error')
      return
    }

    // Recovery: Vite only emits an hmr update after the module re-transforms
    // successfully, so it clears a previously recorded build error. The line
    // looks like "11:05:30 PM [vite] (client) hmr update /src/App.tsx".
    if (this.status === 'error' && /\[vite\][^\n]*hmr update/i.test(text)) {
      this.lastError = null
      this.setStatus('running')
    }
  }

  setStatus(status) {
    if (this.status === status) return
    this.status = status
    emit(this.projectId, 'status', { status, port: this.port, previewUrl: this.previewUrl })
  }

  snapshot() {
    return {
      projectId: this.projectId,
      slug: this.slug,
      status: this.status,
      port: this.port,
      previewUrl: this.previewUrl,
      lastError: this.lastError,
      lastReadyAt: this.lastReadyAt,
      startedAt: this.startedAt,
      logs: this.logs.slice(-120),
      pid: this.child?.pid ?? null,
    }
  }

  get running() {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null
  }

  async install() {
    if (existsSync(path.join(this.dir, 'node_modules'))) return { installed: false, reason: 'present' }
    this.setStatus('installing')
    emit(this.projectId, 'log', { stream: 'system', line: 'Installing dependencies (first run only)…' })

    const result = await new Promise((resolve) => {
      const child = spawn(NPM, ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
        cwd: this.dir,
        env: childEnv(),
        shell: IS_WINDOWS,
        windowsHide: true,
      })
      const timer = setTimeout(() => {
        killTree(child)
        resolve({ ok: false, error: 'npm install timed out' })
      }, INSTALL_TIMEOUT)

      let output = ''
      const onData = (buf) => {
        output += buf.toString()
        this.pushLog('stderr', buf.toString())
      }
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({ ok: false, error: err.message })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ ok: code === 0, code, error: code === 0 ? null : output.slice(-2000) })
      })
    })

    if (!result.ok) {
      this.lastError = result.error || 'npm install failed'
      this.setStatus('error')
      throw new Error(this.lastError)
    }
    emit(this.projectId, 'log', { stream: 'system', line: 'Dependencies installed.' })
    return { installed: true }
  }

  async start({ force = false } = {}) {
    this.lastUsedAt = Date.now()
    if (this.running && !force) return this.snapshot()
    if (force) await this.stop()

    await manager.makeRoom(this)
    await this.install()

    this.logs = []
    this.lastError = null
    this.startedAt = Date.now()
    this.setStatus('starting')

    // Run vite through node directly rather than the npm shim: fewer moving
    // parts on Windows and the child pid stays killable.
    const viteBin = path.join(this.dir, 'node_modules', 'vite', 'bin', 'vite.js')
    const useBin = existsSync(viteBin)
    const command = useBin ? process.execPath : NPM
    const args = useBin
      ? [viteBin, '--port', String(this.port), '--host', '127.0.0.1']
      : ['run', 'dev']

    const child = spawn(command, args, {
      cwd: this.dir,
      env: childEnv({
        PORT: String(this.port),
        // When the server runs inside Electron, process.execPath is the app
        // binary; this flag makes it behave as plain Node so vite.js runs.
        // Real node ignores the variable, so CLI mode is unaffected.
        ...(useBin ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      }),
      shell: useBin ? false : IS_WINDOWS,
      windowsHide: true,
    })
    this.child = child

    child.stdout?.on('data', (buf) => this.pushLog('stdout', buf.toString()))
    child.stderr?.on('data', (buf) => this.pushLog('stderr', buf.toString()))
    child.on('error', (err) => {
      this.lastError = err.message
      this.setStatus('error')
      this.child = null
    })
    child.on('close', (code, signal) => {
      this.child = null
      clearTimeout(this._startTimer)
      if (this.status !== 'error') {
        this.setStatus(code === 0 ? 'stopped' : 'error')
        if (code !== 0 && !this.lastError) {
          this.lastError = `Dev server exited with code ${code} (${signal || 'no signal'})`
        }
      }
      emit(this.projectId, 'log', { stream: 'system', line: `Process exited (${code ?? signal})` })
    })

    // Fall back to an HTTP probe: some Vite versions print nothing we match on.
    await this.waitForReady()
    return this.snapshot()
  }

  async waitForReady() {
    const deadline = Date.now() + START_TIMEOUT
    while (Date.now() < deadline) {
      if (!this.running) return
      if (this.status === 'error') return
      if (await probe(`http://127.0.0.1:${this.port}/`)) {
        this.setStatus('running')
        this.lastReadyAt = Date.now()
        return
      }
      await sleep(600)
    }
    if (this.status === 'starting') {
      this.lastError = this.lastError || 'Dev server did not become ready in time'
      this.setStatus('error')
    }
  }

  async stop() {
    clearTimeout(this._startTimer)
    const child = this.child
    this.child = null
    if (child) {
      await killTree(child)
      emit(this.projectId, 'log', { stream: 'system', line: 'Dev server stopped.' })
    }
    this.setStatus('stopped')
  }

  async restart() {
    return this.start({ force: true })
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]|\x1B\][^\x07]*(?:\x07|\x1B\\)/g

function stripAnsi(text) {
  return String(text).replace(ANSI_RE, '')
}

async function probe(url) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2500)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    return res.ok || res.status === 404
  } catch {
    return false
  }
}

/** Windows has no process groups, so taskkill /T is required to reap vite's children. */
function killTree(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve()
    const done = () => resolve()
    child.once('close', done)
    try {
      if (IS_WINDOWS && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        child.kill('SIGTERM')
        setTimeout(() => {
          try { child.kill('SIGKILL') } catch { /* already gone */ }
        }, 3000)
      }
    } catch {
      resolve()
    }
    setTimeout(done, 6000)
  })
}

class DevServerManager {
  constructor() {
    /** @type {Map<string, DevServer>} */
    this.servers = new Map()
  }

  get(project) {
    let server = this.servers.get(project.id)
    if (!server || server.port !== project.port || server.dir !== project.path) {
      server = new DevServer(project)
      this.servers.set(project.id, server)
    }
    return server
  }

  peek(projectId) {
    return this.servers.get(projectId) || null
  }

  all() {
    return [...this.servers.values()].map((s) => s.snapshot())
  }

  /** Evict least-recently-used servers when the cap is reached. */
  async makeRoom(incoming) {
    const active = [...this.servers.values()]
      .filter((s) => s.running && s.projectId !== incoming.projectId)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)

    while (active.length > MAX_RUNNING_SERVERS - 1) {
      const victim = active.shift()
      emit(victim.projectId, 'log', {
        stream: 'system',
        line: `Stopped to free a slot (max ${MAX_RUNNING_SERVERS} running dev servers).`,
      })
      await victim.stop()
    }
  }

  async startAll(projects) {
    return Promise.all(projects.map((p) => this.get(p).start().catch(() => null)))
  }

  async stopAll() {
    await Promise.all([...this.servers.values()].map((s) => s.stop().catch(() => {})))
  }
}

export const manager = new DevServerManager()
