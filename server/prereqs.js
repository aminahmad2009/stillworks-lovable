import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const IS_WINDOWS = process.platform === 'win32'

// npm is a .cmd shim on Windows, and execFile will not resolve one without it.
const CANDIDATES = {
  git: IS_WINDOWS ? ['git.exe', 'git'] : ['git'],
  npm: IS_WINDOWS ? ['npm.cmd', 'npm'] : ['npm'],
}

/**
 * The two external tools this platform cannot work without: git for per-project
 * history, npm to install and run what the agent generates. Reported rather
 * than assumed, so a missing tool surfaces as "install git" instead of a stack
 * trace from deep inside a scaffold.
 */
export async function checkPrerequisites() {
  const results = {}
  for (const [tool, names] of Object.entries(CANDIDATES)) {
    results[tool] = await probe(names)
  }
  return results
}

async function probe(names) {
  let lastError = 'not found on PATH'
  for (const command of names) {
    try {
      const { stdout } = await run(command, ['--version'], { timeout: 15_000, windowsHide: true })
      return { ok: true, command, version: String(stdout).trim().split('\n')[0] }
    } catch (err) {
      lastError = err.code === 'ENOENT' ? 'not found on PATH' : err.message
    }
  }
  return { ok: false, command: names[0], version: null, error: lastError }
}

/** One-line summary for the boot log. */
export function describePrerequisites(prereqs) {
  return Object.entries(prereqs)
    .map(([tool, r]) => `${tool}: ${r.ok ? r.version : `MISSING (${r.error})`}`)
    .join(' | ')
}
