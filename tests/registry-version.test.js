import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

// Own process and own data dir on purpose: the "registry is newer than me" flag
// is deliberately sticky for the life of the process, so it must not leak into
// the other registry tests.
const dataDir = await mkdtemp(path.join(tmpdir(), 'lovable-registry-newer-'))
process.env.LOVABLE_DATA_DIR = dataDir
process.env.PROJECT_PORT_START = '5900'
process.env.PROJECT_PORT_END = '5999'

const registry = await import('../server/registry.js')
const { REGISTRY_FILE } = await import('../server/config.js')

after(() => rm(dataDir, { recursive: true, force: true }))

test('a registry written by a newer build is readable but never rewritten', async () => {
  const future = {
    version: 99,
    projects: [{
      id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Future', slug: 'future',
      path: path.join(dataDir, 'projects', 'future'), port: 5901, template: 'react-vite',
      createdAt: 1, updatedAt: 1,
    }],
  }
  await writeFile(REGISTRY_FILE, JSON.stringify(future), 'utf8')

  // Reads still work: the owner must be able to open the app and upgrade it.
  const projects = await registry.listProjects()
  assert.equal(projects.length, 1)
  assert.equal(projects[0].slug, 'future')

  const health = registry.registryHealth()
  assert.equal(health.readOnly !== null, true, 'the guard should have tripped')
  assert.match(health.readOnly, /version 99/)

  // Any write must fail loudly rather than downgrade the file.
  await assert.rejects(
    () => registry.touchProject(projects[0].id),
    /Upgrade the app|will not be modified/,
  )
  const onDisk = JSON.parse(await readFile(REGISTRY_FILE, 'utf8'))
  assert.equal(onDisk.version, 99, 'the newer registry must be untouched')
})
