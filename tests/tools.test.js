import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

const root = await mkdtemp(path.join(tmpdir(), 'lovable-tools-'))
const dataDir = await mkdtemp(path.join(tmpdir(), 'lovable-tools-data-'))
process.env.LOVABLE_DATA_DIR = dataDir

after(() => Promise.all([
  rm(root, { recursive: true, force: true }),
  rm(dataDir, { recursive: true, force: true }),
]))

const { executeTool } = await import('../server/tools.js')
const call = (name, args) => executeTool(name, args, { root })

test('mkdir is refused, and the refusal says why it is unnecessary', async () => {
  const out = await call('run_command', { command: 'mkdir -p src/components src/pages' })
  assert.match(out, /^Refused:/)
  // The hint is what lets the agent recover inside the same turn.
  assert.match(out, /write_file/)
  assert.match(out, /parent director/i)
  assert.ok(!existsSync(path.join(root, 'src/components')))
})

test('write_file creates the parent directories that mkdir would have made', async () => {
  const out = await call('write_file', {
    path: 'src/components/deep/Panel.tsx',
    content: 'export const Panel = () => null\n',
  })
  assert.match(out, /src\/components\/deep\/Panel\.tsx/)
  assert.equal(
    (await stat(path.join(root, 'src/components/deep'))).isDirectory(), true,
    'nested folders must appear without a shell command',
  )
  assert.match(await readFile(path.join(root, 'src/components/deep/Panel.tsx'), 'utf8'), /Panel/)
})

test('an allowlisted command is not refused', async () => {
  const out = await call('run_command', { command: 'git status --porcelain' })
  assert.doesNotMatch(out, /^Refused:/)
})

test('a chained command cannot smuggle an unlisted segment', async () => {
  for (const command of [
    'git status --porcelain && echo CHAINMARKER',
    'git status --porcelain; echo CHAINMARKER',
    'git status --porcelain | echo CHAINMARKER',
    'git status --porcelain & echo CHAINMARKER',
    'echo hi && npm install',
  ]) {
    const out = await call('run_command', { command })
    assert.match(out, /^Refused:/, `expected refusal for: ${command}`)
    assert.ok(!out.includes('CHAINMARKER\n'), `segment must not have executed: ${command}`)
  }
})

test('substitution and redirection are refused outright', async () => {
  for (const command of [
    'npm install `whoami`',
    'npm install $(whoami)',
    'npm install > ../../outside.txt',
    'npm run build < input.txt',
  ]) {
    const out = await call('run_command', { command })
    assert.match(out, /^Refused:/, `expected refusal for: ${command}`)
  }
  assert.ok(!existsSync(path.join(root, '..', 'outside.txt')))
})

test('a project script cannot read the platform API keys', async () => {
  const canary = 'platform-secret-canary-do-not-leak'
  process.env.OPENAI_API_KEY = canary
  process.env.ANTHROPIC_AUTH_TOKEN = canary
  try {
    await writeFile(path.join(root, 'peek.js'), 'console.log(JSON.stringify(process.env))', 'utf8')
    const out = await call('run_command', { command: 'node peek.js' })
    assert.match(out, /exit code 0/, 'node must still run, so PATH survived the scrub')
    assert.ok(!out.includes(canary), 'the secret value must not reach tool output')
    assert.doesNotMatch(out, /OPENAI_API_KEY/, 'the key name must not even be visible')
  } finally {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN
  }
})

test('a path that escapes the project is refused by the file tools', async () => {
  const out = await call('write_file', { path: '../outside.txt', content: 'no' })
  assert.match(out, /escapes the project directory/)
})
