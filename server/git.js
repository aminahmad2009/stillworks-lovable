import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const GIT_TIMEOUT = 30_000

async function git(cwd, args, { timeout = GIT_TIMEOUT } = {}) {
  const { stdout } = await run('git', args, {
    cwd,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

export async function isRepo(cwd) {
  try {
    await git(cwd, ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

export async function gitInit(cwd) {
  await git(cwd, ['init', '--quiet'])
  // Commits fail without an identity; set a local one so scaffolded projects
  // always have working history regardless of the user's global config.
  await git(cwd, ['config', 'user.email', 'agent@stillworks.local']).catch(() => {})
  await git(cwd, ['config', 'user.name', 'Stillworks Agent']).catch(() => {})
  await git(cwd, ['config', 'core.autocrlf', 'false']).catch(() => {})
  return true
}

export async function hasChanges(cwd) {
  const out = await git(cwd, ['status', '--porcelain'])
  return out.trim().length > 0
}

export async function gitStatusShort(cwd) {
  if (!(await isRepo(cwd))) return []
  const out = await git(cwd, ['status', '--porcelain'])
  return out
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2).trim(),
      file: line.slice(3),
    }))
}

export async function gitCommitAll(cwd, message) {
  if (!(await isRepo(cwd))) await gitInit(cwd)
  await git(cwd, ['add', '-A'])
  if (!(await hasChanges(cwd))) return { committed: false, reason: 'no-changes' }
  await git(cwd, ['commit', '--quiet', '-m', message])
  const hash = (await git(cwd, ['rev-parse', '--short', 'HEAD'])).trim()
  return { committed: true, hash, message }
}

export async function gitLog(cwd, limit = 20) {
  if (!(await isRepo(cwd))) return []
  const format = '%h%x1f%s%x1f%ct'
  const out = await git(cwd, ['log', `--max-count=${limit}`, `--pretty=format:${format}`])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, ts] = line.split('\x1f')
      return { hash, subject, timestamp: Number(ts) * 1000 }
    })
}

/** Diff for a specific commit, or the working tree against HEAD when ref is omitted. */
export async function gitDiff(cwd, ref) {
  if (!(await isRepo(cwd))) return ''
  const args = ref ? ['diff', ref, '--', '.'] : ['diff', 'HEAD', '--', '.']
  try {
    return await git(cwd, args)
  } catch {
    return ''
  }
}

export async function gitShowDiff(cwd, hash) {
  if (!(await isRepo(cwd))) return ''
  try {
    return await git(cwd, ['show', '--format=%h %s', '--unified=3', hash])
  } catch {
    return ''
  }
}

export async function gitRestore(cwd, hash) {
  if (!(await isRepo(cwd))) throw new Error('Not a git repository')
  await git(cwd, ['checkout', hash, '--', '.'])
  return true
}

/** Discard all uncommitted working-tree changes (tracked + untracked). */
export async function gitDiscardWorking(cwd) {
  if (!(await isRepo(cwd))) throw new Error('Not a git repository')
  await git(cwd, ['checkout', '--', '.'])
  await git(cwd, ['clean', '-fd']).catch(() => {})
  return true
}

/** Remote sync, used for the optional GitHub export flow. */
export async function gitRemoteAdd(cwd, url) {
  await git(cwd, ['remote', 'remove', 'origin']).catch(() => {})
  await git(cwd, ['remote', 'add', 'origin', url])
  return true
}

export async function gitRemoteGet(cwd) {
  try {
    return (await git(cwd, ['remote', 'get-url', 'origin'])).trim() || null
  } catch {
    return null
  }
}

export async function gitPush(cwd, branch = 'main') {
  await git(cwd, ['branch', '-M', branch]).catch(() => {})
  await git(cwd, ['push', '-u', 'origin', branch], { timeout: 120_000 })
  return true
}
