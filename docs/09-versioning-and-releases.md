# 9 · Versioning & releases

## Identity

| Field | Value | Declared in |
|---|---|---|
| Product name | `Stillworks` | `package.json → build.productName`, `productName` |
| **Product ID** | `codewoxy-stillworks` | `package.json → productId` |
| Publisher | `CodeWoxy` | `package.json → company`, `author`, `build.win.publisherName` |
| Desktop app ID | `com.codewoxy.stillworks` | `package.json → build.appId` |
| Repository | `github.com/aminahmad2009/lovable-clone` | `package.json → repository` |
| Version | `0.2.0` | `package.json → version` |

> **Renamed.** This product shipped as **Lovable Local** with product ID `codewoxy-lovable-local`
> through v0.2.0. The name and ID above are the current identity; the old strings survive only in the
> historical changelog entries and in `package.json → legacyProductNames`, which drives the
> `%APPDATA%` migration described in [Desktop app and packaging](08-desktop-and-packaging.md).
> `repository` still points at the original GitHub slug until that is renamed.

The **product ID** is the stable identifier for this product across builds, machines and installs —
it never changes, while the version does. It is what you would use to key licensing, telemetry,
update channels or support tickets, and it is what distinguishes one CodeWoxy product from another
in a fleet. The desktop `appId` is the same string in reverse-DNS form, which is what Windows uses
for install identity, shortcuts and per-machine data.

## Single source of truth

`package.json → version` is the only place a version number is written by hand. Everything else reads
it:

```js
// server/config.js
const pkg = JSON.parse(readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'))
export const APP_VERSION = pkg.version
export const PRODUCT_ID  = pkg.productId || 'codewoxy-stillworks'
export const PRODUCT_NAME = pkg.build?.productName || 'Stillworks'
export const COMPANY      = pkg.company || 'CodeWoxy'
export const REPOSITORY   = …
```

From there it reaches:

- `GET /api/health` → `version`, `productId`, `product`, `company`, `repository`
- the server startup banner
- the sidebar version chip and the About panel
- `electron/main.js` (reads the same `package.json`) → window title, tray tooltip and menu header,
  `app.setAboutPanelOptions`
- electron-builder → installer filename and Windows metadata

There is no second copy to forget.

## Semver policy

`MAJOR.MINOR.PATCH`, pre-1.0:

- **PATCH** — bug fixes, no new capability. The agent loop, tools, API and settings shape are
  unchanged.
- **MINOR** — new features, new tools, new endpoints, new settings fields, backwards-compatible
  changes to the event stream. Also the bump for anything a user would notice and want to read about.
- **MAJOR** — breaking changes: a removed or renamed endpoint, a settings-shape change that needs a
  migration, a change to the on-disk registry or history format, dropping a Node version.

Because data lives in `data/` and survives upgrades, a MAJOR bump is the signal that a migration or
a manual step may be needed. Say so in the changelog under a `### Migration` heading.

## Changelog discipline

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): an `[Unreleased]`
section at the top, then one section per release with `Added`, `Changed`, `Deprecated`, `Removed`,
`Fixed`, `Security`, `Migration` as applicable, newest first, each dated `YYYY-MM-DD`.

Write entries for **users**, not for the diff: what changed in behaviour, what they can now do, what
might surprise them. Name the setting, tool, endpoint or event that changed.

`npm run version:check` fails the build if `CHANGELOG.md` has no `## [<version>]` heading for the
version in `package.json`, so an undocumented release cannot ship:

```
> node -e "…if(!c.includes('## ['+p.version+']')){…process.exit(1)}"
CHANGELOG.md is missing an entry for 0.3.0
```

Compare links at the bottom of the file (`[Unreleased]`, `[0.2.0]`, …) point at GitHub
compare/release URLs and should be updated with each release.

## Release checklist

1. Decide the bump (patch / minor / major) from the diff.
2. Update `package.json → version`.
3. Move the `[Unreleased]` entries into a new `## [x.y.z] — YYYY-MM-DD` section, leave an empty
   `[Unreleased]` behind, and add the compare link at the bottom.
4. `npm run version:check` → must pass.
5. Run the test suites (image generation, agent error contract) and smoke-test a real turn.
6. `npm run dist:win` → confirm the artifact is named `Stillworks-Setup-x.y.z.exe`, install it,
   and check the About panel reports `x.y.z`.
7. Commit `chore(release): x.y.z`, tag it, push both:
   ```bash
   git add -A && git commit -m "chore(release): 0.2.0"
   git tag -a v0.2.0 -m "Stillworks 0.2.0"
   git push origin main --tags
   ```
8. Publish a GitHub Release from the tag with the changelog section as the body and the installer
   attached.

## Tags

Tags are `v<version>` (`v0.1.0`, `v0.2.0`), annotated, and match the changelog headings and the
installer filenames exactly. The changelog's per-version links resolve against them.

## What is *not* versioned

- `data/` — user state, git-ignored, migrates forward in place.
- `release/` — build output, git-ignored.
- Generated projects — they have their own git histories and their own `package.json` versions,
  entirely independent of the tool's.
