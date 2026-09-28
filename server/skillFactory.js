/* The skill factory: a browsable catalog of ready-made skills that live in a
 * public git repo. The index is a single skills.json; each entry points at a
 * folder holding a SKILL.md whose body becomes the skill's brief once the user
 * downloads it. The remote copy is authoritative, the bundled local_skills_repo
 * is the offline fallback, and nothing is written to disk until the user asks. */

import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { ROOT_DIR } from './config.js'

const REPO_BASE = 'https://raw.githubusercontent.com/aminahmad2009/lovable-clone/main/local_skills_repo'
const REMOTE_INDEX = `${REPO_BASE}/skills.json`
const LOCAL_DIR = path.join(ROOT_DIR, 'local_skills_repo')

const CACHE_TTL = 5 * 60 * 1000
const FETCH_TIMEOUT = 8000
const MAX_BRIEF = 16000

let cache = null
let cacheAt = 0

const remoteSkillUrl = (id) => `${REPO_BASE}/${encodeURIComponent(id)}/SKILL.md`

/** Only ids that cannot escape the repo directory are ever turned into paths. */
function safeId(id) {
  const clean = String(id || '').trim()
  return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(clean) ? clean : null
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
  if (!response.ok) throw Object.assign(new Error(`${response.status} from ${url}`), { status: response.status })
  return response.text()
}

/**
 * Parse a SKILL.md: YAML-ish frontmatter between --- fences, then the body.
 * Returns null when the document has no usable body.
 */
export function parseSkillMarkdown(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '')
  let meta = {}
  let body = raw
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (match) {
    body = raw.slice(match[0].length)
    for (const line of match[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  body = body.trim()
  if (!body) return null
  return { meta, body }
}

/** "build-error-rescue" -> "Build Error Rescue"; anything else passes through. */
function humanName(value, fallbackId) {
  const raw = String(value || '').trim()
  if (!raw) return String(fallbackId || 'Untitled skill')
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(raw)) return raw
  return raw.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** Turn a catalog entry plus its SKILL.md into the shape skills.js stores. */
export function skillFromDocument(entry, parsed) {
  // The index carries the display name; frontmatter `name:` is usually the slug.
  const name = humanName(entry?.name || parsed.meta.name, entry?.id)
  const description = parsed.meta.description || entry?.description || ''
  const tags = Array.isArray(entry?.tags) && entry.tags.length
    ? entry.tags
    : String(entry?.keywords || '').split(',').map((t) => t.trim()).filter(Boolean)
  return {
    name: name.slice(0, 60),
    icon: entry?.icon || '🧩',
    description: String(description).slice(0, 160),
    tags: tags.slice(0, 8),
    brief: parsed.body.slice(0, MAX_BRIEF),
    origin: entry?.id || null,
    source: 'factory',
    homepage: entry?.id ? remoteSkillUrl(entry.id) : null,
    version: entry?.version || null,
    author: entry?.author || null,
  }
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const id = safeId(entry.id || entry.skillId)
  if (!id) return null
  return {
    id,
    name: String(entry.name || id).slice(0, 60),
    icon: entry.icon || '🧩',
    description: String(entry.description || '').slice(0, 200),
    tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 8) : [],
    installs: Number(entry.installs) || 0,
    official: Boolean(entry.isOfficial),
    version: entry.version ? String(entry.version) : null,
  }
}

async function readLocalIndex() {
  const raw = await readFile(path.join(LOCAL_DIR, 'skills.json'), 'utf8')
  return JSON.parse(raw)
}

const PLACEHOLDER = /^(a skill for|skill for)?\s*[a-z0-9-]*$/i

/**
 * The catalog index carries placeholder descriptions ("A skill for x"), which
 * makes search useless. Pull the real one-line description out of each
 * SKILL.md frontmatter. Best-effort: a skill that fails to load keeps whatever
 * the index said, so a slow or partial network never empties the catalog.
 */
async function enrich(skills) {
  const settled = await Promise.all(skills.slice(0, 200).map(async (entry) => {
    if (entry.description && !PLACEHOLDER.test(entry.description)) return entry
    try {
      const text = await fetchText(remoteSkillUrl(entry.id))
      const parsed = parseSkillMarkdown(text)
      const description = parsed?.meta?.description
      return description ? { ...entry, description: description.slice(0, 200) } : entry
    } catch {
      try {
        const text = await readFile(path.join(LOCAL_DIR, entry.id, 'SKILL.md'), 'utf8')
        const parsed = parseSkillMarkdown(text)
        const description = parsed?.meta?.description
        return description ? { ...entry, description: description.slice(0, 200) } : entry
      } catch {
        return entry
      }
    }
  }))
  return [...settled, ...skills.slice(200)]
}

/**
 * The catalog, remote-first with a five-minute cache. `origin` reports which
 * copy answered so the UI can say the list is offline.
 */
export async function factoryCatalog({ refresh = false } = {}) {
  if (!refresh && cache && Date.now() - cacheAt < CACHE_TTL) {
    return { skills: cache.skills, origin: cache.origin }
  }
  try {
    const parsed = JSON.parse(await fetchText(REMOTE_INDEX))
    const skills = (Array.isArray(parsed) ? parsed : parsed.skills || [])
      .map(normalizeEntry).filter(Boolean)
    if (!skills.length) throw new Error('the catalog is empty')
    const enriched = await enrich(skills)
    cache = { skills: enriched, origin: 'remote' }
    cacheAt = Date.now()
    return { skills: enriched, origin: 'remote' }
  } catch (err) {
    try {
      const parsed = await readLocalIndex()
      const skills = (Array.isArray(parsed) ? parsed : parsed.skills || [])
        .map(normalizeEntry).filter(Boolean)
      cache = { skills, origin: 'local' }
      cacheAt = Date.now()
      return { skills, origin: 'local', warning: err.message }
    } catch (localErr) {
      throw Object.assign(
        new Error(`The skill catalog could not be loaded (${err.message}; bundled copy: ${localErr.message}).`),
        { status: 502 },
      )
    }
  }
}

/**
 * Fetch one skill's SKILL.md and shape it for installation. Remote first so a
 * newly published skill is picked up even when the bundled copy is stale.
 */
export async function factorySkill(id) {
  const clean = safeId(id)
  if (!clean) throw Object.assign(new Error('That skill id is not valid.'), { status: 400 })

  const { skills } = await factoryCatalog()
  const entry = skills.find((s) => s.id === clean)

  let text = null
  let from = null
  try {
    text = await fetchText(remoteSkillUrl(clean))
    from = 'remote'
  } catch {
    try {
      text = await readFile(path.join(LOCAL_DIR, clean, 'SKILL.md'), 'utf8')
      from = 'local'
    } catch {
      throw Object.assign(
        new Error(`"${clean}" has no SKILL.md in the catalog, so there is nothing to download.`),
        { status: 404 },
      )
    }
  }

  const parsed = parseSkillMarkdown(text)
  if (!parsed) {
    throw Object.assign(new Error(`"${clean}" has an empty SKILL.md.`), { status: 422 })
  }
  return { ...skillFromDocument(entry || { id: clean }, parsed), id: clean, from }
}

/** Case-insensitive substring match across name, description, id and tags. */
export function filterCatalog(skills, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return skills
  return skills.filter((s) => [s.id, s.name, s.description, ...(s.tags || [])]
    .join(' ').toLowerCase().includes(q))
}
