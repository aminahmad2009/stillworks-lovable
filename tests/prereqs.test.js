import test from 'node:test'
import assert from 'node:assert/strict'

const { checkPrerequisites, describePrerequisites } = await import('../server/prereqs.js')

test('git and npm are reported with a version, not just a boolean', async () => {
  const prereqs = await checkPrerequisites()
  assert.deepEqual(Object.keys(prereqs).sort(), ['git', 'npm'])
  for (const [tool, result] of Object.entries(prereqs)) {
    assert.equal(typeof result.ok, 'boolean', `${tool}.ok`)
    assert.ok(result.command, `${tool} should name the command it tried`)
    if (result.ok) assert.match(result.version, /\d/, `${tool} version should look like a version`)
  }
  // Both exist here (CI installs git), so a green run must say so.
  assert.equal(prereqs.git.ok, true, 'git is required by the whole test suite')
})

test('describePrerequisites names a missing tool instead of hiding it', () => {
  const line = describePrerequisites({
    git: { ok: true, command: 'git', version: 'git version 2.45.1' },
    npm: { ok: false, command: 'npm.cmd', error: 'not found on PATH' },
  })
  assert.match(line, /git: git version 2\.45\.1/)
  assert.match(line, /npm: MISSING \(not found on PATH\)/)
})
