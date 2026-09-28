/* MCP server manager: start/stop/restart servers from persisted configs,
 * aggregate their tools, and expose a unified `tools` list to the agent. */

import path from 'node:path'
import { DATA_DIR, readJson, writeJsonAtomic } from '../config.js'
import { createMcpClient } from './client.js'

const MCP_FILE = path.join(DATA_DIR, 'mcp.json')

/** Allowed commands for stdio MCP servers — prevents arbitrary code execution. */
const ALLOWED_COMMANDS = new Set(['npx', 'uvx', 'node', 'python', 'python3', 'deno', 'bun'])

export function isAllowedCommand(cmd) {
  const base = path.basename(String(cmd || '')).replace(/\.cmd$|\.bat$|\.exe$/i, '')
  return ALLOWED_COMMANDS.has(base)
}

/** Validate an MCP config before persisting or starting it. */
export function validateConfig(input) {
  const cfg = { ...input }
  if (!cfg.name || !String(cfg.name).trim()) throw Object.assign(new Error('name is required'), { status: 400 })
  cfg.name = String(cfg.name).trim().slice(0, 64)

  if (cfg.transport === 'stdio') {
    if (!cfg.command) throw Object.assign(new Error('command is required for stdio transport'), { status: 400 })
    if (!isAllowedCommand(cfg.command)) {
      throw Object.assign(
        new Error(`"${cfg.command}" is not in the allowed MCP command allowlist (${[...ALLOWED_COMMANDS].join(', ')})`),
        { status: 400 },
      )
    }
    cfg.args = Array.isArray(cfg.args) ? cfg.args.map(String) : []
    cfg.env = cfg.env && typeof cfg.env === 'object' ? cfg.env : {}
  } else {
    if (!cfg.url || !/^https?:\/\//.test(cfg.url)) {
      throw Object.assign(new Error('A valid HTTP(S) URL is required for remote MCP servers'), { status: 400 })
    }
    cfg.headers = cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {}
  }

  cfg.enabled = cfg.enabled !== false
  // Double underscores would break the mcp__<serverId>__<tool> name parsing.
  cfg.id = cfg.id || cfg.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/_+/g, '_')
  return cfg
}

/* ------------------------------------------------------------------ state */

let _configs = null
let _clients = new Map()   // id → { client, config, ready, error }

async function loadConfigs() {
  if (_configs !== null) return _configs
  const data = await readJson(MCP_FILE, { servers: [] })
  _configs = Array.isArray(data.servers) ? data.servers : []
  return _configs
}

async function saveConfigs(servers) {
  _configs = servers
  await writeJsonAtomic(MCP_FILE, { servers, updatedAt: Date.now() })
}

/* -------------------------------------------------------------- public API */

/** All configured servers with their current runtime status. */
export async function listServers() {
  const configs = await loadConfigs()
  return configs.map((cfg) => {
    const runtime = _clients.get(cfg.id)
    return {
      ...cfg,
      running: runtime?.ready ?? false,
      error: runtime?.error || null,
      toolCount: runtime?.client?.tools?.length ?? 0,
    }
  })
}

/** Start (or restart) one server by id. Returns the refreshed server entry. */
export async function startServer(id) {
  const configs = await loadConfigs()
  const cfg = configs.find((c) => c.id === id)
  if (!cfg) throw Object.assign(new Error('No such MCP server'), { status: 404 })

  // Stop any existing instance first.
  await stopServer(id).catch(() => {})

  const client = createMcpClient(cfg)
  try {
    await client.initialize()
  } catch (err) {
    await client.stop().catch(() => {})
    const runtime = { client, config: cfg, ready: false, error: err.message }
    _clients.set(id, runtime)
    throw err
  }

  const runtime = { client, config: cfg, ready: true, error: null }
  _clients.set(id, runtime)
  return { ...cfg, running: true, toolCount: client.tools.length, error: null }
}

/** Stop one server gracefully. */
export async function stopServer(id) {
  const runtime = _clients.get(id)
  if (!runtime) return
  await runtime.client.stop().catch(() => {})
  _clients.delete(id)
}

/** Restart = stop + start. */
export async function restartServer(id) {
  await stopServer(id)
  return startServer(id)
}

/** Aggregate all tools from every running server, prefixed with mcp__<serverId>__.
 * The shape matches TOOL_DEFINITIONS in tools.js (`input_schema`), which is
 * what both LLM adapters send to the provider. Names are capped at 64 chars —
 * OpenAI rejects longer function names, taking the whole request down. */
export function aggregatedTools() {
  const tools = []
  for (const [id, runtime] of _clients) {
    if (!runtime.ready) continue
    for (const t of runtime.client.tools) {
      tools.push({
        name: qualifiedName(id, t.name),
        description: `[${id}] ${t.description}`,
        input_schema: t.inputSchema || { type: 'object', properties: {} },
      })
    }
  }
  return tools
}

function qualifiedName(serverId, toolName) {
  return `mcp__${serverId}__${toolName}`.slice(0, 64)
}

/** Execute a tool call on the correct server. */
export async function executeMcpTool(qualifiedName, args) {
  const match = qualifiedName.match(/^mcp__(.+?)__(.+)$/)
  if (!match) throw new Error(`Not an MCP tool: ${qualifiedName}`)
  const [, serverId, toolName] = match
  const runtime = _clients.get(serverId)
  if (!runtime?.ready) throw new Error(`MCP server "${serverId}" is not running`)
  // A 64-char cap may have truncated the name; fall back to a prefix match.
  const tool = runtime.client.tools.find((t) => t.name === toolName)
    || runtime.client.tools.find((t) => t.name.startsWith(toolName))
  return runtime.client.callTool(tool ? tool.name : toolName, args)
}

/* --------------------------------------------------------- CRUD operations */

export async function addServer(input) {
  const cfg = validateConfig(input)
  const configs = await loadConfigs()
  if (configs.some((c) => c.id === cfg.id)) {
    throw Object.assign(new Error(`A server with id "${cfg.id}" already exists`), { status: 409 })
  }
  configs.push(cfg)
  await saveConfigs(configs)
  return cfg
}

export async function updateServer(id, patch) {
  const configs = await loadConfigs()
  const idx = configs.findIndex((c) => c.id === id)
  if (idx === -1) throw Object.assign(new Error('No such MCP server'), { status: 404 })
  const merged = validateConfig({ ...configs[idx], ...patch, id })
  configs[idx] = merged
  await saveConfigs(configs)
  // If the server was running, restart it so changes take effect.
  if (_clients.has(id)) await restartServer(id).catch(() => {})
  return merged
}

export async function removeServer(id) {
  await stopServer(id)
  const configs = await loadConfigs()
  const next = configs.filter((c) => c.id !== id)
  await saveConfigs(next)
  return { deleted: id }
}

/** Auto-start all enabled servers at boot. Called once during server startup. */
export async function bootMcpServers() {
  const configs = await loadConfigs()
  for (const cfg of configs) {
    if (cfg.enabled) {
      startServer(cfg.id).catch((err) => {
        console.error(`[mcp] failed to auto-start "${cfg.id}":`, err.message)
      })
    }
  }
}
