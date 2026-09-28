# Stillworks

**Built by CodeWoxy** · product ID `codewoxy-stillworks` · version `0.2.0` ·
[Changelog](CHANGELOG.md) · [Documentation](docs/README.md)

A single-user, on-device prompt-to-app studio. You describe an app in a chat panel, an
agent edits real files in a real project on your disk, and a live preview updates as it works.
Every project is an ordinary Vite + React + TypeScript + Tailwind app with its own git history —
nothing here is a proprietary format.

No multi-tenancy, no billing, no hosted publishing. One machine, one user, as many projects as you
want.

## Documentation

Full documentation lives in [`docs/`](docs/README.md): overview, getting started, architecture, the
agent loop and tool reference, providers and image generation, the HTTP/SSE API reference, the web UI
guide, desktop packaging, versioning and releases, and troubleshooting. Release notes are in
[`CHANGELOG.md`](CHANGELOG.md). Draft legal documents (EULA, terms, privacy, refunds) are in
[`legal/`](legal/README.md) and are **not legal advice** — see the checklist there before publishing.

## Quick start

```bash
node server/index.js        # or: npm start
npm test                    # registry suites against a throwaway data dir (no model calls)
```

Then open <http://127.0.0.1:4310>. There is no install step for the platform itself — the server
and the control panel use only Node built-ins.

Requirements: Node 20.10+ (tested on 22), git on PATH. Generated projects install their own
dependencies with npm on first start.

## Adding a model

The agent needs an LLM. Open **Settings** in the panel and either pick a preset (OpenAI,
OpenRouter, Groq, Together, Azure, custom endpoint) or enter any OpenAI-compatible base URL, key
and model name. **Test connection** verifies it with a one-token call before you spend anything.

Environment variables work too and take effect when the matching field is left blank:
`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, and for the Anthropic adapter
`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`.

Keys you type into Settings are stored in `data/settings.json` on this machine. Keys that come
from the environment are never written to disk.

A third provider, `mock`, is scripted rather than a model. It exists so the agent loop can be
exercised without spending tokens; the UI shows a banner whenever it is active.

## Image generation

Optional, in **Settings → Image model**: any OpenAI-compatible endpoint that serves
`POST /images/generations`. Leave the base URL and key blank to reuse the OpenAI-compatible text
endpoint — a gateway that serves both only needs a model name. Environment overrides:
`IMAGE_API_KEY`, `IMAGE_BASE_URL`, `IMAGE_MODEL`, `IMAGE_SIZE`.

The agent then gets an `image_generation` tool that saves real artwork into the project
(`public/generated/<name>.png`, referenced as `/generated/<name>`) instead of drawing SVG
placeholders. Resolution order is: the dedicated image model → the active OpenAI-compatible text
endpoint → an error naming every attempt made and what to fix. **Test image model** in Settings
generates a throwaway 256×256 image so a bad model name or base URL is caught before the agent hits
it.

## Desktop app

```bash
npm install        # once — electron + electron-builder are devDependencies
npm run desktop    # native window with the server running in-process
npm run dist:win   # → release/Stillworks-Setup-0.2.0.exe
```

The packaged app is tray-resident (closing hides it), has no native menubar, and stores its data in
`%APPDATA%/Stillworks/data` rather than the install directory. See
[docs/08-desktop-and-packaging.md](docs/08-desktop-and-packaging.md).

## What a turn looks like

1. You send a message in **Plan** mode (discussion only, no tools) or **Agent** mode.
2. The agent gets a system prompt containing the project's live file tree and the stack rules,
   plus the conversation so far.
3. It calls tools — `list_files`, `read_file`, `write_file`, `edit_file`, `delete_file`,
   `search_files`, `run_command`, `image_generation` — streamed to the panel as collapsible events.
4. The dev server for that project is already running, so a broken edit is caught immediately:
   Vite's transform error is parsed and handed straight back to the agent to fix in the same turn.
5. When the model stops calling tools, the working tree is committed with your message as the
   subject, and the History tab shows the diff.

## Multi-project model

Each project lives in `data/projects/<slug>/` with its own git repo and its own dev server on a
reserved port (5180 by default, allocated upward). Duplicate names get `-2`, `-3` suffixes — and a
folder left behind by a removal still counts as that name, so nothing is ever written into it.
Servers are started on demand and evicted least-recently-used when more than
`MAX_RUNNING_SERVERS` (default 4) would run at once. The registry survives restarts; servers do
not auto-start.

Removing a project unregisters it, stops its server and drops its chat history, but leaves the folder
alone. Tick the box in the same dialog to move that folder to `data/.trash/`; only **Empty trash**
deletes for good. Folders the registry no longer points at are listed on the home grid, where you can
adopt one back or throw it away.

Every project is an ordinary git repository, so `Set remote` + `Push` in the History tab sends its
history to a remote you own. That is the only sync on offer — there is still no hosted publishing.

## Safety model

The agent has full read/write access **inside its project directory only** — every file tool
resolves paths against the project root and refuses escapes. The shell is the exception and is
allowlisted: package-manager commands, `node` on project scripts, `tsc`, and read-mostly git.
Anything else is refused and reported back to the model. Since the command string goes to a shell,
every `;`/`&`/`|`-separated segment is checked and substitution or redirection is refused outright — a
permitted prefix cannot smuggle an unpermitted command.

Project processes do not inherit this server's environment. `npm install`, `node` on a project script,
the dev server and MCP connectors get a scrubbed set (`PATH`, home and temp dirs, locale, proxy/CA
config, `npm_config_*`), so neither generated code nor a dependency's postinstall script can read your
API keys; opt a name back in with `LOVABLE_CHILD_ENV`. Export ZIPs skip `.env` and `.env.*` for the
same reason. The preview iframe is sandboxed with `allow-scripts allow-same-origin`, which is required
for HMR and `localStorage` in generated apps but means generated code runs with its own origin's
privileges — acceptable for local use, worth knowing about.

## Layout

```
server/
  index.js       HTTP API, SSE event stream, static hosting for the panel
  config.js      paths, product identity, settings layering (defaults < settings.json < env), presets
  registry.js    project registry, ports, chat history, per-project usage, orphan detection
  scaffold.js    template instantiation with {{PLACEHOLDER}} expansion
  devserver.js   per-project Vite process manager, log ring buffer, error detection
  agent.js       the loop: system prompt, tool dispatch, self-healing, terminal-event contract, auto-commit
  tools.js       sandboxed file tools, image_generation, command allowlist
  files.js       file tree, read/write and content search used by the panel
  git.js         init, commit, log, diff, restore
  designs.js     the built-in design/style catalogue
  skills.js      the reusable skills library (built-ins + user skills in data/skills.json)
  zip.js         dependency-free zip writer used by /export
  llm/           provider adapters: openai.js, anthropic.js, image.js, mock.js, shared SSE parser
  templates/     the react-vite and vue-vite starters copied into new projects
web/             the control panel: index.html, styles.css, app.js (no build step)
tests/           node:test suites over the registry (data dirs are throwaway, no tokens spent)
electron/        main.js + preload.cjs — tray-resident desktop wrapper running the server in-process
build/           icon.png for the packaged app
docs/            the detailed documentation set (see docs/README.md)
data/            runtime state: projects/, meta/, .trash/, registry.json (+ .bak mirror),
                 skills.json, settings.json (git-ignored)
CHANGELOG.md     release notes, Keep a Changelog format
```

## What this is not

Compared with a hosted builder, there is no credit metering, no team permissions,
no database/auth integration wizard, no one-click public deployment, and no native mobile target.
The agent's quality is exactly the quality of the model you point it at — the platform supplies
the loop, the sandbox and the feedback, not the intelligence.

## Verified

Tested end to end on Windows with Node 22: scaffold install and boot, two concurrent dev servers,
duplicate-name handling, registry persistence across restarts, tool execution and auto-commit,
SSE streaming of every event type, build-error detection and recovery, path-traversal refusal,
and the full panel UI in a browser. The OpenAI and Anthropic adapters are verified for request
shape and error handling; live model output depends on the key you supply.

Two behaviour-focused suites were run against stub HTTP servers (they stand in for a real
OpenAI-compatible endpoint, so no tokens were spent): the image-generation suite (22 assertions —
target resolution order, key/base-URL inheritance from the text endpoint, no-capability when only an
Anthropic key exists, save path and explicit path handling, path-escape refusal, the
`response_format` 400 retry, `url` responses, empty `data`, and the aggregated multi-attempt error)
and the agent terminal-event suite (28 assertions — every failure path emits exactly one of
`turn:end` / `turn:error` / `turn:aborted`, empty model responses retry then surface a specific
error, and aborts report `aborted: true`). Both pass; neither is committed to the repo.
