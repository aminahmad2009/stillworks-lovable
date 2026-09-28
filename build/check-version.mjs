/**
 * Release guard. package.json is the version source of truth, so anything that
 * restates it has to agree: the changelog needs an entry for the version, and
 * the panel's structured data (search engines read it) must name the same one.
 *
 *   npm run version:check
 */
import { readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const panel = await readFile(new URL('../web/index.html', import.meta.url), 'utf8')

const problems = []
if (!changelog.includes(`## [${pkg.version}]`)) {
  problems.push(`CHANGELOG.md has no entry for ${pkg.version}`)
}
if (!panel.includes(`"softwareVersion": "${pkg.version}"`)) {
  problems.push(`web/index.html JSON-LD does not declare ${pkg.version}`)
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`version ${pkg.version} agrees across package.json, CHANGELOG.md and the panel metadata`)
