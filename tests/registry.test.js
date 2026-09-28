import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

// config.js reads the environment at import time, so the data dir and port
// range have to be set before anything touches the server modules.
const dataDir = await mkdtemp(path.join(tmpdir(), 'lovable-registry-'))
process.env.LOVABLE_DATA_DIR = dataDir
process.env.PROJECT_PORT_START = '5600'
process.env.PROJECT_PORT_END = '5699'

after(() => rm(dataDir, { recursive: true, force: true }))

const registry = await import('../server/registry.js')
const { PROJECTS_DIR, TRASH_DIR, REGISTRY_FILE } = await import('../server/config.js')

const slugOf = (project) => project.slug

test('create registers a project and writes its folder', async () => {
  const created = await registry.createProject({ name: 'Widget' })
  assert.equal(slugOf(created), 'widget')
  assert.ok(existsSync(registry.projectPath('widget')))
  assert.ok(existsSync(registry.metaPath(created.id)))
  assert.equal((await registry.listProjects()).length, 1)
})

test('removing without deleteFiles keeps the folder on disk', async () => {
  const [project] = await registry.listProjects()
  const removed = await registry.deleteProject(project.id)
  assert.equal(removed.trashedTo, null)
  assert.equal((await registry.listProjects()).length, 0)
  assert.ok(existsSync(registry.projectPath('widget')), 'folder must survive an unregister')
  assert.equal((await registry.listTrash()).length, 0)
})

test('a leftover folder still claims its slug', async () => {
  const created = await registry.createProject({ name: 'Widget' })
  assert.equal(slugOf(created), 'widget-2', 'the orphaned widget/ dir must not be overwritten')
})

test('deleting files moves the folder to the trash rather than destroying it', async () => {
  const [project] = await registry.listProjects()
  const removed = await registry.deleteProject(project.id, { deleteFiles: true })
  assert.ok(removed.trashedTo?.startsWith(TRASH_DIR), 'expected a trash destination')
  assert.ok(!existsSync(registry.projectPath('widget-2')))
  assert.ok(existsSync(path.join(removed.trashedTo, 'package.json')))
  const trashed = await registry.listTrash()
  assert.equal(trashed.length, 1)
  assert.ok(trashed[0].name.startsWith('widget-2-'))
})

test('orphans are listed, adoptable by path, and trashed by name', async () => {
  const stray = path.join(PROJECTS_DIR, 'stray-folder')
  await mkdir(stray, { recursive: true })
  await writeFile(path.join(stray, 'package.json'), '{"name":"stray"}', 'utf8')

  const orphans = await registry.findOrphanDirs()
  const found = orphans.find((o) => o.slug === 'stray-folder')
  assert.ok(found, 'stray-folder should be reported as an orphan')
  assert.equal(found.path, stray)

  const adopted = await registry.importProject({ name: 'Stray', dir: stray })
  assert.equal(adopted.template, 'imported')
  assert.equal((await registry.findOrphanDirs()).some((o) => o.slug === 'stray-folder'), false)

  await registry.deleteProject(adopted.id)
  await registry.trashOrphanDir('stray-folder')
  assert.ok(!existsSync(stray))
  assert.ok((await registry.listTrash()).some((item) => item.name.startsWith('stray-folder-')))
})

test('a slug that escapes the projects dir is refused', async () => {
  await assert.rejects(() => registry.trashOrphanDir('../settings'), /Invalid folder name/)
  await assert.rejects(() => registry.trashOrphanDir(''), /Invalid folder name/)
})

test('a torn registry.json is recovered from its mirror', async () => {
  const created = await registry.createProject({ name: 'Keepme' })
  assert.ok(existsSync(`${REGISTRY_FILE}.bak`), 'every write should leave a mirror behind')

  await writeFile(REGISTRY_FILE, '{ not valid json', 'utf8')
  await registry.findOrphanDirs() // any read triggers the recovery path

  const projects = await registry.listProjects()
  assert.equal(projects.length, 1)
  assert.equal(projects[0].id, created.id)
})

test('emptying the trash is the permanent step', async () => {
  const result = await registry.emptyTrash()
  assert.ok(result.removed >= 1)
  assert.equal((await registry.listTrash()).length, 0)
})
