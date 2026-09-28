import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, readFile, writeFile, readdir, stat, rename, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import {
  PROJECTS_DIR, META_DIR, TRASH_DIR, REGISTRY_FILE, PROJECT_PORT_START, PROJECT_PORT_END,
  ensureDataDirs, readJson, writeJsonAtomic,
} from './config.js'
import { scaffoldProject, slugify } from './scaffold.js'
import { gitInit, gitCommitAll, gitLog, gitStatusShort, gitDiff, gitRemoteGet } from './git.js'

const EMPTY_REGISTRY = { projects: [], version: 1 }
const REGISTRY_BACKUP = `${REGISTRY_FILE}.bak`

/** The registry shape this build understands. */
const REGISTRY_VERSION = 1

/**
 * Set once when registry.json was written by a newer build. Reads continue so
 * the owner can upgrade, but writes are refused forever after — an old app
 * silently downgrading a new install's registry is unrecoverable data loss.
 */
let registryTooNew = null

async function readRegistry() {
  await ensureDataDirs()
  const data = await readJson(REGISTRY_FILE, null)
  if (data && Array.isArray(data.projects)) {
    if (Number(data.version) > REGISTRY_VERSION && !registryTooNew) {
      registryTooNew = `registry.json is version ${data.version}; this build writes version ${REGISTRY_VERSION}. Upgrade the app before making changes — the file will not be modified.`
      console.error(`[registry] ${registryTooNew}`)
    }
    return data
  }
  // A registry.json that exists but will not parse means a torn write: fall
  // back to the mirror of the last successful one rather than starting empty,
  // which would silently orphan every project on disk.
  if (data === null && existsSync(REGISTRY_FILE)) {
    const backup = await readJson(REGISTRY_BACKUP, null)
    if (backup && Array.isArray(backup.projects)) {
      console.warn('[registry] registry.json unreadable — recovered from registry.json.bak')
      await writeJsonAtomic(REGISTRY_FILE, backup)
      return backup
    }
  }
  return { ...EMPTY_REGISTRY }
}

async function writeRegistry(registry) {
  if (registryTooNew) throw new Error(registryTooNew)
  await writeJsonAtomic(REGISTRY_FILE, registry)
  await copyFile(REGISTRY_FILE, REGISTRY_BACKUP).catch(() => {})
}

/** Registry health for /api/health and the diagnostics bundle. */
export function registryHealth() {
  return { understoodVersion: REGISTRY_VERSION, readOnly: registryTooNew }
}

/**
 * Move a directory into data/.trash rather than deleting it, so a removal stays
 * recoverable. Returns the destination, or null when the folder is still held
 * open (a dev server that has not released its handles on Windows).
 */
async function moveToTrash(dir, label) {
  if (!existsSync(dir)) return null
  await mkdir(TRASH_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(TRASH_DIR, `${label}-${stamp}`)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await rename(dir, dest)
      return dest
    } catch (err) {
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)))
    }
  }
  return null
}

/** Find the lowest port in range that is both unassigned and not listening. */
async function allocatePort(registry) {
  const taken = new Set(registry.projects.map((p) => p.port).filter(Boolean))
  for (let port = PROJECT_PORT_START; port <= PROJECT_PORT_END; port++) {
    if (taken.has(port)) continue
    const free = await new Promise((resolve) => {
      const tester = createServer()
      tester.once('error', () => resolve(false))
      tester.once('listening', () => tester.close(() => resolve(true)))
      tester.listen(port, '127.0.0.1')
    })
    if (free) return port
  }
  throw new Error(`No free port available in range ${PROJECT_PORT_START}-${PROJECT_PORT_END}`)
}

export function projectPath(slug) {
  return path.join(PROJECTS_DIR, slug)
}

export function metaPath(id) {
  return path.join(META_DIR, id)
}

/** Serialize a project for the API. Runtime status is injected by the caller. */
function toPublic(project, runtime = {}) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    path: project.path,
    port: project.port,
    template: project.template,
    designId: project.designId || null,
    skillIds: project.skillIds || [],
    usage: project.usage || { inputTokens: 0, outputTokens: 0, turns: 0 },
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    previewUrl: project.port ? `http://127.0.0.1:${project.port}` : null,
    ...runtime,
  }
}

export async function listProjects() {
  const registry = await readRegistry()
  return [...registry.projects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

export async function getProject(idOrSlug) {
  const registry = await readRegistry()
  const key = String(idOrSlug || '').toLowerCase()
  return registry.projects.find(
    (p) => p.id === idOrSlug || p.slug.toLowerCase() === key || p.name.toLowerCase() === key,
  ) || null
}

export async function touchProject(id) {
  const registry = await readRegistry()
  const project = registry.projects.find((p) => p.id === id)
  if (!project) return null
  project.updatedAt = Date.now()
  await writeRegistry(registry)
  return project
}

export async function createProject({ name, template = 'react-vite' }) {
  await ensureDataDirs()
  const registry = await readRegistry()

  const baseSlug = slugify(name)
  let slug = baseSlug
  let n = 2
  // Folders left behind by an unregister-only removal are not in the registry,
  // but they still occupy the slug on disk, so they count as taken too.
  const onDisk = await readdir(PROJECTS_DIR, { withFileTypes: true })
    .then((entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name))
    .catch(() => [])
  const taken = new Set([...registry.projects.map((p) => p.slug), ...onDisk])
  while (taken.has(slug)) slug = `${baseSlug}-${n++}`

  const dir = projectPath(slug)
  if (existsSync(dir)) {
    throw new Error(`Directory already exists at ${dir}`)
  }

  const port = await allocatePort(registry)
  const id = randomUUID()

  await mkdir(dir, { recursive: true })
  try {
    await scaffoldProject(dir, { name, slug, template })
    await mkdir(metaPath(id), { recursive: true })
  } catch (err) {
    // Never leave a half-built folder behind: it would show up as an orphan
    // and permanently block that slug.
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    await rm(metaPath(id), { recursive: true, force: true }).catch(() => {})
    throw err
  }

  const project = {
    id,
    name,
    slug,
    path: dir,
    port,
    template,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  registry.projects.push(project)
  await writeRegistry(registry)

  // Best-effort version control; a missing git binary must not block creation.
  try {
    await gitInit(dir)
    await gitCommitAll(dir, 'Initial scaffold')
  } catch (err) {
    console.warn(`[registry] git init failed for ${slug}: ${err.message}`)
  }

  return project
}

export async function renameProject(id, name) {
  const registry = await readRegistry()
  const project = registry.projects.find((p) => p.id === id)
  if (!project) throw new Error('Project not found')
  project.name = name
  project.updatedAt = Date.now()
  await writeRegistry(registry)
  return project
}

/** Set (or clear, when designId is null) the design preset for a project. */
export async function setProjectDesign(id, designId) {
  const registry = await readRegistry()
  const project = registry.projects.find((p) => p.id === id)
  if (!project) throw new Error('Project not found')
  if (designId) project.designId = designId
  else delete project.designId
  await writeRegistry(registry)
  return project
}

/** Replace the list of enabled skill ids for a project. */
export async function setProjectSkills(id, skillIds) {
  const registry = await readRegistry()
  const project = registry.projects.find((p) => p.id === id)
  if (!project) throw new Error('Project not found')
  const clean = [...new Set((Array.isArray(skillIds) ? skillIds : []).map(String).filter(Boolean))]
  if (clean.length) project.skillIds = clean
  else delete project.skillIds
  await writeRegistry(registry)
  return project
}

/** Accumulate token usage for a project across turns. */
export async function addProjectUsage(id, usage) {
  const registry = await readRegistry()
  const project = registry.projects.find((p) => p.id === id)
  if (!project) return null
  const current = project.usage || { inputTokens: 0, outputTokens: 0, turns: 0 }
  project.usage = {
    inputTokens: current.inputTokens + (usage?.inputTokens || 0),
    outputTokens: current.outputTokens + (usage?.outputTokens || 0),
    turns: current.turns + 1,
  }
  await writeRegistry(registry)
  return project.usage
}

/** Adopt an existing folder on disk as a project (no scaffold, no copy). */
export async function importProject({ name, dir }) {
  await ensureDataDirs()
  const registry = await readRegistry()

  const abs = path.resolve(dir)
  const info = await stat(abs).catch(() => null)
  if (!info || !info.isDirectory()) throw new Error(`Not a directory: ${dir}`)
  if (registry.projects.some((p) => path.resolve(p.path) === abs)) {
    throw new Error('That folder is already registered as a project')
  }

  const baseSlug = slugify(name || path.basename(abs))
  let slug = baseSlug
  let n = 2
  const taken = new Set(registry.projects.map((p) => p.slug))
  while (taken.has(slug)) slug = `${baseSlug}-${n++}`

  const port = await allocatePort(registry)
  const id = randomUUID()
  await mkdir(metaPath(id), { recursive: true })

  const project = {
    id,
    name: name || path.basename(abs),
    slug,
    path: abs,
    port,
    template: 'imported',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  registry.projects.push(project)
  await writeRegistry(registry)

  try {
    await gitInit(abs)
    await gitCommitAll(abs, 'Imported into Stillworks')
  } catch (err) {
    console.warn(`[registry] git init failed for imported ${slug}: ${err.message}`)
  }
  return project
}

/**
 * Drop a project from the registry. Its metadata dir always goes; the working
 * directory only goes when deleteFiles is set, because imported projects point
 * at folders the user owns. Removed folders move to data/.trash.
 */
export async function deleteProject(id, { deleteFiles = false } = {}) {
  const registry = await readRegistry()
  const index = registry.projects.findIndex((p) => p.id === id)
  if (index === -1) throw new Error('Project not found')
  const [project] = registry.projects.splice(index, 1)
  await writeRegistry(registry)

  let trashedTo = null
  if (deleteFiles) {
    trashedTo = await moveToTrash(project.path, project.slug)
    if (!trashedTo) {
      console.warn(`[registry] could not move ${project.path} to the trash — it is still on disk`)
    }
  }
  await rm(metaPath(project.id), { recursive: true, force: true })
  return { ...project, trashedTo }
}

/* ------------------------------- chat history ------------------------------ */

export async function loadHistory(id) {
  const file = path.join(metaPath(id), 'history.json')
  const data = await readJson(file, { messages: [] })
  return Array.isArray(data.messages) ? data.messages : []
}

export async function appendHistory(id, messages) {
  const file = path.join(metaPath(id), 'history.json')
  await mkdir(metaPath(id), { recursive: true })
  const current = await readJson(file, { messages: [] })
  const list = Array.isArray(current.messages) ? current.messages : []
  list.push(...messages)
  // Keep the on-disk transcript bounded so long-lived projects stay loadable.
  const trimmed = list.slice(-400)
  await writeJsonAtomic(file, { messages: trimmed, updatedAt: Date.now() })
  return trimmed
}

export async function clearHistory(id) {
  const file = path.join(metaPath(id), 'history.json')
  await mkdir(metaPath(id), { recursive: true })
  await writeJsonAtomic(file, { messages: [], updatedAt: Date.now() })
}

/* ------------------------------ git shortcuts ----------------------------- */

export async function projectGitSummary(project) {
  try {
    const [status, log, remote] = await Promise.all([
      gitStatusShort(project.path),
      gitLog(project.path, 20),
      gitRemoteGet(project.path),
    ])
    return { available: true, status, log, remote }
  } catch (err) {
    return { available: false, error: err.message }
  }
}

export async function projectDiff(project, ref) {
  return gitDiff(project.path, ref)
}

/** List project folders present on disk but missing from the registry (orphans). */
export async function findOrphanDirs() {
  const registry = await readRegistry()
  const known = new Set(registry.projects.map((p) => p.slug))
  // Imported projects live wherever their owner keeps them, so their folder name
  // need not match their slug — compare absolute paths as well.
  const knownPaths = new Set(registry.projects.map((p) => path.resolve(p.path)))
  const entries = await readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => [])
  const orphans = []
  for (const entry of entries.filter((e) => e.isDirectory())) {
    const dir = path.join(PROJECTS_DIR, entry.name)
    if (known.has(entry.name) || knownPaths.has(path.resolve(dir))) continue
    orphans.push({
      slug: entry.name,
      path: dir,
      updatedAt: (await stat(dir).catch(() => null))?.mtimeMs || null,
    })
  }
  return orphans
}

/** Resolve a name to a direct child of the projects dir, refusing escapes. */
function childOfProjectsDir(name) {
  const root = path.resolve(PROJECTS_DIR)
  const dir = path.resolve(root, String(name || ''))
  if (dir === root || path.dirname(dir) !== root) throw new Error(`Invalid folder name: ${name}`)
  return dir
}

/** Move a leftover folder that no registry entry points at into the trash. */
export async function trashOrphanDir(name) {
  const dir = childOfProjectsDir(name)
  const registry = await readRegistry()
  if (registry.projects.some((p) => path.resolve(p.path) === dir)) {
    throw new Error('That folder belongs to a project in the list')
  }
  if (!existsSync(dir)) throw new Error('No such folder')
  if (!(await moveToTrash(dir, path.basename(dir)))) {
    throw new Error('Could not move that folder to the trash — close anything using it and try again.')
  }
  return { trashed: path.basename(dir) }
}

/** What currently sits in data/.trash, newest first. */
export async function listTrash() {
  await ensureDataDirs()
  const entries = await readdir(TRASH_DIR, { withFileTypes: true }).catch(() => [])
  const items = []
  for (const entry of entries.filter((e) => e.isDirectory())) {
    items.push({
      name: entry.name,
      path: path.join(TRASH_DIR, entry.name),
      deletedAt: (await stat(path.join(TRASH_DIR, entry.name)).catch(() => null))?.mtimeMs || null,
    })
  }
  return items.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
}

/** Delete everything in the trash permanently. This is the one irreversible call. */
export async function emptyTrash() {
  const items = await listTrash()
  for (const item of items) {
    await rm(item.path, { recursive: true, force: true }).catch(() => {})
  }
  return { removed: items.length }
}

export { toPublic }
