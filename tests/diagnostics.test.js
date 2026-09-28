import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 4711
const base = `http://127.0.0.1:${PORT}`
const CANARY = 'DIAGNOSTICS-MUST-NEVER-PRINT-THIS'

// A real server on a throwaway data dir, because the property worth proving is
// that a file designed to leave the machine cannot carry a key with it.
const dataDir = await mkdtemp(path.join(tmpdir(), 'lovable-diag-'))
await writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({
  provider: 'openai',
  openai: { apiKey: CANARY, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
}), 'utf8')

const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', STILLWORKS_DATA_DIR: dataDir },
  stdio: 'ignore',
})

after(async () => {
  child.kill()
  await rm(dataDir, { recursive: true, force: true })
})

async function waitForServer(deadlineMs = 25_000) {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    try {
      const res = await fetch(`${base}/api/health`)
      if (res.ok) return
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('test server did not start')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

test('health reports prerequisites and registry state', async () => {
  await waitForServer()
  const health = await (await fetch(`${base}/api/health`)).json()
  assert.equal(health.product, 'Stillworks')
  assert.equal(health.productId, 'codewoxy-stillworks')
  assert.ok(health.prerequisites?.git, 'health should report git')
  assert.equal(health.prerequisites.git.ok, true)
  assert.equal(health.registry.understoodVersion, 1)
  assert.equal(health.registry.readOnly, null)
  // The canary key is configured, yet health must not say so in a readable form.
  assert.doesNotMatch(JSON.stringify(health), new RegExp(CANARY))
})

test('the diagnostics bundle is downloadable, complete and key-free', async () => {
  const res = await fetch(`${base}/api/diagnostics`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-disposition') || '', /attachment; filename="codewoxy-stillworks-diagnostics-.*\.json"/)

  const text = await res.text()
  assert.doesNotMatch(text, new RegExp(CANARY), 'a diagnostics file must never carry an API key')

  const bundle = JSON.parse(text)
  assert.equal(bundle.app.product, 'Stillworks')
  assert.ok(bundle.system.node, 'system details are the point of the bundle')
  assert.equal(bundle.prerequisites.git.ok, true)
  assert.ok(Array.isArray(bundle.registry.projects))
  assert.equal(bundle.settings.openai.hasKey, true, 'the key should be reported as present…')
  assert.equal(bundle.settings.openai.apiKey, '•'.repeat(8), '…but masked')
  assert.ok(Array.isArray(bundle.servers))
})

test('an unknown route still answers as JSON, not as the panel', async () => {
  const res = await fetch(`${base}/api/not-a-real-route`)
  assert.equal(res.status, 404)
  assert.match(res.headers.get('content-type') || '', /application\/json/)
})
