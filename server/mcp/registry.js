/* Official MCP Registry — https://registry.modelcontextprotocol.io
 * Provides a browsable catalog of known MCP servers with their transport
 * details, repository links, and package identifiers. */

const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io/v0'
const CACHE_TTL = 10 * 60 * 1000   // 10 minutes
const FETCH_TIMEOUT = 8000

let cache = null
let cacheAt = 0

/** Fetch the server catalog. Remote-first with a local-timeout fallback. */
export async function mcpCatalog({ search = '', limit = 50, cursor, refresh = false } = {}) {
  if (!refresh && cache && Date.now() - cacheAt < CACHE_TTL) {
    return filterCached(cache, search, limit, cursor)
  }

  try {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (limit) params.set('limit', String(Math.min(limit, 200)))
    if (cursor) params.set('cursor', cursor)

    const response = await fetch(`${REGISTRY_BASE}/servers?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!response.ok) throw new Error(`Registry returned ${response.status}`)

    const data = await response.json()
    const servers = (data.servers || []).map(normaliseEntry).filter(Boolean)
    cache = { servers, nextCursor: data.metadata?.nextCursor || null }
    cacheAt = Date.now()
    return filterCached(cache, search, limit, cursor)
  } catch (err) {
    if (cache) {
      // Stale-but-useful: return cached results with a warning.
      return { ...filterCached(cache, search, limit, cursor), warning: err.message }
    }
    throw Object.assign(new Error(`The MCP registry is unreachable: ${err.message}`), { status: 502 })
  }
}

/** Get detail for one server by its registry name. */
export async function mcpServerDetail(name) {
  try {
    const response = await fetch(`${REGISTRY_BASE}/servers/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!response.ok) throw new Error(`Registry returned ${response.status}`)
    return normaliseEntry(await response.json())
  } catch (err) {
    throw Object.assign(new Error(`Could not fetch "${name}": ${err.message}`), { status: 502 })
  }
}

/* ---------------------------------------------------------------- helpers */

function filterCached(cached, search, limit, cursor) {
  let list = cached.servers
  if (search) {
    const q = search.toLowerCase()
    list = list.filter((s) => [s.name, s.description, ...(s.tags || [])]
      .join(' ').toLowerCase().includes(q))
  }
  if (cursor) {
    const idx = list.findIndex((s) => s.cursor === cursor)
    if (idx !== -1) list = list.slice(idx + 1)
  }
  if (limit) list = list.slice(0, limit)
  return {
    servers: list,
    total: cached.servers.length,
    nextCursor: cached.nextCursor,
    cachedAt: cacheAt,
  }
}

function normaliseEntry(entry) {
  // The registry wraps each entry under a `server` key.
  const srv = entry?.server || entry
  if (!srv || typeof srv !== 'object') return null
  const name = String(srv.name || '').trim()
  if (!name) return null

  // Transport: stdio or streamable-http/sse
  const remotes = Array.isArray(srv.remotes) ? srv.remotes : []
  const remote = remotes[0] || null
  const transportType = remote?.type || (Array.isArray(srv.packages) && srv.packages[0]?.transport?.type) || 'stdio'

  // Build a ready-to-use config skeleton for each transport.
  let configTemplate = null
  if (transportType === 'stdio') {
    // For stdio servers the registry doesn't always list an npx package;
    // use the name as a hint (e.g. "@modelcontextprotocol/server-filesystem").
    const cmd = name.startsWith('@') ? name.split('/')[1] : name.split('/').pop()
    configTemplate = {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', name],
    }
  } else if (transportType === 'streamable-http' || transportType === 'sse' || transportType === 'http') {
    configTemplate = {
      transport: 'http',
      url: remote?.url || '',
    }
  }

  return {
    name,
    description: String(srv.description || srv.title || '').slice(0, 300),
    tags: Array.isArray(srv.tags) ? srv.tags.slice(0, 8) : [],
    repository: srv.repository?.url || null,
    homepage: srv.homepage || srv.repository?.url || null,
    transportType,
    remotes: remotes.map((r) => ({ type: r.type, url: r.url })),
    packages: (srv.packages || []).map((p) => ({
      identifier: p.identifier,
      registry: p.registry,
      transport: p.transport?.type || 'stdio',
    })),
    configTemplate,
    version: srv.version || null,
    cursor: srv._meta?.cursor || null,
  }
}
