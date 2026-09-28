import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const work = await mkdtemp(path.join(tmpdir(), 'lovable-sandbox-'))
process.env.LOVABLE_DATA_DIR = work

const { childEnv } = await import('../server/config.js')
const { zipDirectory } = await import('../server/zip.js')

after(() => rm(work, { recursive: true, force: true }))

test('childEnv keeps what npm, git and node need to start', () => {
  const env = childEnv()
  assert.ok(env.PATH, 'PATH must survive or nothing can be spawned')
  for (const name of ['HOME', 'USERPROFILE', 'TEMP', 'TMP', 'SYSTEMROOT', 'COMSPEC']) {
    if (process.env[name]) assert.equal(env[name], process.env[name], `${name} should pass through`)
  }
})

test('childEnv drops credentials and the NODE_OPTIONS injection vector', () => {
  const kept = {
    OPENAI_API_KEY: 'sk-secret',
    ANTHROPIC_API_KEY: 'sk-ant-secret',
    GITHUB_TOKEN: 'ghp_secret',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    NODE_OPTIONS: '--require ./evil.js',
  }
  Object.assign(process.env, kept)
  try {
    const env = childEnv()
    for (const [name, value] of Object.entries(kept)) {
      assert.equal(env[name], undefined, `${name} must not reach a project process`)
    }
  } finally {
    for (const name of Object.keys(kept)) delete process.env[name]
  }
})

test('LOVABLE_CHILD_ENV opts a specific name back in', () => {
  process.env.BUILD_NUMBER = '184'
  process.env.LOVABLE_CHILD_ENV = 'BUILD_NUMBER'
  try {
    assert.equal(childEnv().BUILD_NUMBER, '184')
    assert.equal(childEnv({}).LOVABLE_CHILD_ENV, undefined)
  } finally {
    delete process.env.BUILD_NUMBER
    delete process.env.LOVABLE_CHILD_ENV
  }
})

test('caller-supplied overrides win, so secrets are per project by choice', () => {
  const env = childEnv({ PORT: '5199', API_TOKEN: 'from-the-connector' })
  assert.equal(env.PORT, '5199')
  assert.equal(env.API_TOKEN, 'from-the-connector')
  assert.equal(env.FORCE_COLOR, '0')
})

test('an export carries the app but never the dotenv secrets', async () => {
  const project = path.join(work, 'project')
  await mkdir(path.join(project, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(path.join(project, 'README.md'), '# the app\n', 'utf8')
  await writeFile(path.join(project, '.env'), 'OPENAI_API_KEY=ZIP-SHOULD-NOT-CARRY-THIS\n', 'utf8')
  await writeFile(path.join(project, '.env.production'), 'TOKEN=PROD-SECRET-ABSENT\n', 'utf8')
  await writeFile(path.join(project, '.env.example'), 'OPENAI_API_KEY=\n', 'utf8')
  await writeFile(path.join(project, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n', 'utf8')

  const archive = (await zipDirectory(project)).toString('latin1')

  assert.ok(archive.includes('README.md'), 'the app itself must be exported')
  assert.ok(archive.includes('.env.example'), 'the template is meant to travel')
  assert.ok(!archive.includes('ZIP-SHOULD-NOT-CARRY-THIS'), '.env must not be exported')
  assert.ok(!archive.includes('PROD-SECRET-ABSENT'), '.env.* must not be exported')
  assert.ok(!archive.includes('node_modules'), 'dependencies are installed, not shipped')
})
