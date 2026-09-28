# Changelog

All notable changes to **Stillworks** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

- **Product ID:** `codewoxy-stillworks`
- **Built by:** CodeWoxy
- **Version source of truth:** `package.json` → `version`, surfaced at runtime by
  `server/config.js` (`APP_VERSION`, `PRODUCT_ID`), by `GET /api/health`, and by the
  version chip in the sidebar (click it for the About panel).

---

## [Unreleased]

### Added

- **Removal without data loss.** `Remove project…` sits under **Export ZIP** in the
  Files sidebar, so a project can be dropped from the list without leaving the
  workspace. Removing only unregisters; the checkbox moves the folder to
  `data/.trash/` instead of deleting it.
- **Leftovers panel on the home grid.** Folders under `data/projects/` with no
  registry entry are now listed with **Adopt** (register in place) and
  **Move to trash**, and the trash itself is listed with **Empty trash** as the
  one permanent step.
- **Rename** on the home cards, wired to the `PATCH /api/projects/:id` endpoint
  that already existed with no caller. Only the display name changes; the slug
  and folder are untouched.
- **Push to a git remote.** The History sidebar shows the project's `origin`,
  with **Set remote** and **Push**, using the `gitRemoteAdd` / `gitPush` helpers
  that were in `server/git.js` but unreachable. https, ssh, `file://` and
  `git@…` URLs are accepted and anything starting with a dash is refused.
- **`← Projects`** in the workspace header — the first way back to the home grid
  that does not require a page refresh.
- **Registry mirror.** Every registry write leaves `registry.json.bak`; a
  `registry.json` that exists but will not parse is restored from it on the next
  read instead of booting with an empty project list.
- **Test suite and CI.** `tests/registry.test.js` covers slug allocation, the
  two removal modes, orphan adopt/trash, path-escape refusal and corrupt-registry
  recovery. `npm test` runs it; `.github/workflows/ci.yml` runs a syntax sweep,
  the tests and `version:check` on Node 20 and 22.
- **macOS and Linux packaging targets** (`dist:mac`, `dist:linux`) alongside the
  existing Windows installer.
- **A complete icon set for the panel.** `build/icon.png` is the only artwork, and
  `npm run icons:build` derives `web/icons/` from it: 16/32/48/192/512 px favicons,
  `favicon.ico`, an 180 px apple-touch icon, a full-bleed maskable variant and a
  1200×630 social card. The master paints its rounded square on an opaque white
  page, so the derived favicons are clipped to the artwork's own measured corner
  radius instead of showing white corners at small sizes.
- **Crawler metadata in the panel head.** Description, per-scheme theme colors,
  the icon and manifest links, `og:`/`twitter:` tags, `web/robots.txt`,
  `web/site.webmanifest` and a `SoftwareApplication` JSON-LD block. Nothing in the
  visible UI changed: the title text, layout, copy and behaviour are untouched,
  and `tests/assets.test.js` asserts that no metadata leaked into the body.
- **Missing tools are named, not guessed at.** `server/prereqs.js` probes `git` and `npm` once at
  boot and reports them through `GET /api/health`. An amber banner above the project grid says
  "git and npm are not installed … install them and restart" instead of letting the first scaffold die
  inside `npm install`, and the boot log prints the same line.
- **A newer `registry.json` is now read-only.** If the file's `version` is ahead of what this build
  writes, reads keep working so the owner can upgrade, but every write throws rather than rewriting the
  registry in an older shape. An old app silently downgrading a new install's project list used to be
  unrecoverable.
- **Settings → Download diagnostics.** `GET /api/diagnostics` returns one attachment-shaped JSON file:
  app identity and paths, OS/Node versions, a fresh prerequisite probe, the full registry, running
  server log tails, per-project git dirtiness and the settings block. Every API key passes through the
  same masking the panel uses, so the file is safe to email — `tests/diagnostics.test.js` boots a real
  server with a canary key and asserts the value never appears in the output.
- **Draft legal documents in `legal/`.** EULA, terms of sale, privacy policy and refund policy, written
  against the app's actual behaviour rather than a template: the privacy policy enumerates every outbound
  endpoint the code really touches (your configured model provider, the npm registry,
  `registry.modelcontextprotocol.io` for the connector catalogue, the skills catalogue on
  `raw.githubusercontent.com`), states plainly that **API keys are currently stored unencrypted in
  `settings.json`**, and warns that the local control server has no authentication. `legal/README.md`
  lists the placeholders to fill and the facts to re-check before publishing. **Drafts, not legal
  advice** — they need a lawyer in your jurisdiction.

### Changed

- **The product is now Stillworks.** Previously "Lovable Local" (product ID
  `codewoxy-lovable-local`, appId `com.codewoxy.lovable-local`); now **Stillworks**
  (`codewoxy-stillworks`, `com.codewoxy.stillworks`), with the installer, desktop
  shortcut, window title, About panel, brand text, git commit author
  (`Stillworks Agent <agent@stillworks.local>`) and MCP client info following.
  Publisher stays CodeWoxy. The old name described the product as a clone, which
  is not a position to sell from.
  - Packaged data moves from `%APPDATA%/Lovable Local/data` to
    `%APPDATA%/Stillworks/data`: first launch copies the legacy folder across,
    never overwrites, and **never deletes the original**, then logs and notifies.
  - `STILLWORKS_DATA_DIR` replaces `LOVABLE_DATA_DIR`, which still works as a
    deprecated alias so existing scripts and shortcuts are unaffected.
  - Historical entries below keep the old name — they record what shipped.
  - Not renamed: the GitHub repository slug and the `github.com/lovable-local/*`
    skill URLs in `skills.json`, which are external locations, not strings.
- **`npm run version:check` now also pins the metadata.** The one-line `node -e`
  script became `build/check-version.mjs`, which additionally requires the JSON-LD
  `softwareVersion` to match `package.json`, so the advertised version cannot drift.
- **Static file types.** `MIME` gained `.webmanifest`, `.txt`, `.jpg`, `.jpeg` and
  `.webp`; without the first, the manifest was served as
  `application/octet-stream` and browsers would not read it.

- **`DELETE /api/projects/:id` is non-destructive by default.** It unregisters,
  stops the server, aborts any turn and drops the chat history, but leaves the
  folder on disk; pass `?files=1` to move it to the trash. The response reports
  `filesDeleted` and, when the folder could not be moved, `folderLeftAt`.
- **A leftover folder claims its slug.** Creating a project whose name matches a
  folder on disk now takes the next free suffix rather than failing with
  "Directory already exists".
- **Orphan detection compares absolute paths, not just slugs**, so an imported
  project living outside `data/projects/<slug>` is no longer misreported.

### Security

- **Generated projects can no longer read this server's credentials.** `npm install`,
  `node` on a project script, the dev server and MCP connectors inherited
  `process.env` wholesale, so anything the model wrote — or any dependency's
  postinstall script — could read the platform's API keys and every credential in
  the shell that started it (verified: a project script listed `OPENAI_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN` and unrelated tokens from the environment). Children now
  get `childEnv()`, a deny-by-default allowlist of `PATH`, home/temp dirs, locale,
  proxy and CA config and `npm_config_*`; `NODE_OPTIONS` is excluded because it can
  inject code into every child. A connector's own `env` block and a project's
  `PORT` are still merged in, and `LOVABLE_CHILD_ENV=FOO,BAR` opts names back in.
- **The command allowlist checks every segment, not just the prefix.** It matched
  the start of a string handed to a shell, so
  `git status --porcelain && echo CHAINMARKER` executed the second command. Each
  `;`, `&`, `|` and newline-separated segment must now clear the allowlist, and
  backticks, `$(…)` and `<`/`>` are refused outright — the last because `>` could
  write outside the project where the file tools cannot.
- **Export ZIPs exclude dotenv files.** `.env` and `.env.*` are no longer archived
  (`.env.example` is kept), so sharing a project cannot leak a secret the agent
  stored where the template's own `.gitignore` says it belongs.

Covered by `tests/sandbox.test.js` and three new cases in `tests/tools.test.js`.

### Fixed

- **`Refused: "mkdir -p …" is not on the allowlist` no longer stalls a turn.**
  `write_file` and `edit_file` already create every missing parent directory, so
  the shell call was never needed. The refusal now says that in the tool output
  the model reads, and the rule is stated up front in the system prompt and the
  `run_command` description, so the agent writes into the new folders directly
  instead of stopping to ask. Covered by `tests/tools.test.js`.
- **The template picker cannot offer a template that does not exist.** `nextjs` and
  `svelte-vite` were listed by `GET /api/templates` and had prompt briefs in
  `frameworkNotes()`, but their folders are not in `server/templates/`, so choosing
  one failed with `Unknown template` the moment the dialog was confirmed. The list
  is now filtered against what is installed and will pick them up automatically if
  the folders return.

---

## [0.2.0] — 2026-09-22

### Added

- **Image generation.** New optional OpenAI-compatible image endpoint under
  Settings → Image model (base URL, API key, model name, default size). Blank
  base URL / key inherit from the OpenAI-compatible text provider, so a gateway
  that serves both only needs a model name. Environment overrides:
  `IMAGE_API_KEY`, `IMAGE_BASE_URL`, `IMAGE_MODEL`, `IMAGE_SIZE`.
- **`image_generation` agent tool.** Saves into the project (default
  `public/generated/<slug>-<id>.png`) and returns the URL path to reference in
  code. Resolution order: dedicated image model → active OpenAI-compatible text
  endpoint → a thrown error that lists every attempt made and what to fix.
  Handles `b64_json` and `url` responses, and retries once without
  `response_format` / `size` when a gateway rejects those parameters.
- **"Test image model"** button in Settings — generates a throwaway 256×256
  image and reports model, source, byte size and latency, or the exact failure.
- **Agent persona is image-aware.** The system prompt now states which image
  model is configured (or that none is) and instructs the agent to prefer
  generated imagery over SVG placeholders, and to report failures rather than
  stopping quietly.
- **Skills library.** Twelve built-in skills (accessibility, responsive layout,
  forms, loading states, motion, dark mode, data fetching, state management,
  performance, data viz, SEO metadata, testing) plus full CRUD for user-defined
  skills. Enabled skills are injected into the system prompt per project.
- **Collapsible "Thinking" blocks** in chat: reasoning streams live behind a
  dropdown arrow, is labelled `Thought for Ns` when it finishes, and is replayed
  collapsed from history on reload.
- **About panel** (sidebar version chip) showing product name, product ID,
  version, publisher, active text provider, image model, project count and both
  directories.
- **`system:notice` event** for non-fatal agent notices (empty-response retry,
  dev server that failed to start) rendered as a system line in chat.
- **`docs/`** — full project documentation: overview, architecture, server
  modules, agent loop, tool reference, providers, settings, HTTP API, UI guide,
  desktop packaging, skills and troubleshooting.
- **Build identity in metadata.** `package.json` now carries `company`,
  `productName`, `productId`, `repository`, `homepage`, `bugs` and
  `license`; electron-builder `appId` is `com.codewoxy.lovable-local`,
  `publisherName` is CodeWoxy, and installer artifacts are named
  `Lovable Local-Setup-<version>.exe`.
- **`npm run version:check`** — fails if `CHANGELOG.md` has no entry for the
  version in `package.json`, so a release cannot ship undocumented.

### Changed

- **No more silent agent stops.** Every turn now emits exactly one terminal
  event. An empty model response (no text and no tool calls — including the
  "reasoning only, then cut off" case) is retried twice with a visible notice,
  then reported as a proper error in the chat response area with the model name,
  stop reason and a hint. Failures after the model loop (history write, usage
  write) are also reported instead of being swallowed.
- The HTTP chat route re-emits `turn:error` as a safety net if the agent throws
  without having reported it.
- **Transport errors are translated.** Node's `fetch` rejects with the useless
  `fetch failed`; `describeNetworkError()` now converts connection-refused, DNS,
  timeout, dropped-socket and TLS failures into a sentence naming the host, with
  an actionable hint printed underneath. User aborts and HTTP errors pass through
  untouched. Retry detection now also matches the transient error codes, not just
  the wording.
- Aborts are reported consistently as `turn:aborted` and return
  `{ aborted: true }` whichever path detects them.
- The system prompt now requires the agent to end every turn with a short text
  reply, so an empty reply is always a bug rather than a valid outcome.
- `executeTool` takes a context object (`{ root, onLog, settings, provider, signal }`)
  and appends a `Hint:` line to tool errors that carry one.
- Removed the native File/Edit/View/Window menubar from the desktop app; the
  tray menu now shows the product name, version and publisher.
- Server startup banner prints product name, version, product ID, publisher,
  data directory, provider state and image model.

### Fixed

- Thinking-block animated dots stayed visible after the block was finalised.
- A turn that failed after the model loop left the chat panel spinning with no
  message and no error.
- An unreachable model endpoint surfaced in chat as the bare string
  `fetch failed`; it now names the host and says what to check.
- The startup banner reported the number of tracked dev servers where it meant
  the concurrency cap (`max 0 tracked`); it now prints the port range, the cap
  and the tracked count.

### Security

- `data/` (registry, settings, per-project files and chat history) is no longer
  tracked by git. `data/settings.json` holds provider API keys in plaintext, and
  an earlier commit included it — rotate any key that was ever committed and
  pushed.

---

## [0.1.0] — 2026-09-21

First working end-to-end build.

### Added

- Zero-dependency Node ESM control server on `127.0.0.1:4310` (no runtime
  packages; `node:` built-ins only).
- Multi-project registry with unique ports (5180–5380), per-project git
  repositories, and a cap on concurrently running dev servers.
- Project scaffolding for React 19 + Vite + TypeScript + Tailwind 4 and
  Vue 3 + Vite + TypeScript + Tailwind 4.
- Agent loop with streaming tool calls, retry/backoff on provider throttling,
  step cap, dev-server self-healing on build errors, auto-install when
  `package.json` changes, and auto-commit (or review-before-commit) per turn.
- Tool set: `list_files`, `read_file`, `write_file`, `edit_file`,
  `delete_file`, `search_files`, `run_command` (allowlisted).
- LLM adapters: OpenAI-compatible `/chat/completions` (OpenAI, Groq,
  OpenRouter, Together, Azure, NVIDIA, any gateway), Anthropic Messages, and an
  offline `mock` provider for UI work.
- SSE event bus streaming agent, tool, dev-server, git and file events to the UI.
- Web control panel (vanilla JS, no build step): project grid, chat with
  Plan/Agent modes, live iframe preview with device widths and console capture,
  code editor with file tree and regex search, commit history with diffs and
  restore, dev-server logs, settings modal with connection test.
- Reference-image attachments in chat (data URL or base64, up to 8).
- Design preset library with search, applied per project.
- Per-project cumulative token totals, typecheck runner, zip export, and
  import-existing-folder (adopted in place, git initialised if missing).
- Light/dark theme toggle.
- Electron desktop wrapper: in-process server, tray-resident, single-instance
  lock, writable `userData/data` when packaged, and an NSIS installer.

[Unreleased]: https://github.com/aminahmad2009/lovable-clone/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/aminahmad2009/lovable-clone/releases/tag/v0.2.0
[0.1.0]: https://github.com/aminahmad2009/lovable-clone/releases/tag/v0.1.0
