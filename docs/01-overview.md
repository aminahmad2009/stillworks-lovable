# 1 · Overview

## What it is

Stillworks is a **prompt-to-app builder that runs entirely on your machine**: describe it, watch it
build, see it live — with none of the hosting, account or collaboration machinery. The output is an
ordinary Vite project with its own git history, so nothing is locked in.

One control server, one browser window (or one Electron window), any number of projects.

## The core loop

1. **Create a project.** A folder is scaffolded under `data/projects/<slug>` from a template
   (React 19 or Vue 3, both Vite + TypeScript + Tailwind 4), initialised as its own git repo, and
   assigned a unique dev-server port in the 5180–5380 range.
2. **Describe what you want** in the chat panel, in Plan mode (discussion only, no tools) or Agent
   mode (full file access).
3. **The agent works.** It streams a model response, calls tools to read and write files, installs
   dependencies when `package.json` changes, and keeps going until the request is done or the step
   cap is hit. Its reasoning, text, tool calls and tool output all stream into the chat as they
   happen.
4. **The preview updates.** The project's Vite dev server is running the whole time, so edits appear
   in the iframe within a second. If an edit breaks the build, the compiler error is fed straight
   back to the agent, which fixes it without being asked.
5. **The turn is committed.** By default each turn ends in a git commit with a message derived from
   your prompt. You can switch to review-before-commit and approve or revert each turn instead.

## Feature map

**Projects** — multi-project registry; create from template or import an existing folder in place;
rename; delete (stops the server, removes the folder); zip export; unique ports; a cap on how many
dev servers run at once.

**Agent** — Plan and Agent modes; streaming tool calls; provider retry with backoff on 429/5xx;
configurable step cap; build-error self-healing; auto-install; auto-commit or review-before-commit;
per-project cumulative token totals; abort at any time.

**Chat** — collapsible per-step Thinking blocks (reasoning streamed live, replayed collapsed from
history); reference-image attachments (up to 8, data URL or base64); tool call cards with arguments,
live output and pass/fail state; system notices; errors rendered as first-class messages.

**Knowledge injection** — a design preset library (visual starting points) and a skills library
(12 built-in plus unlimited user-defined), both selected per project and injected into the system
prompt on every turn.

**Editor & code** — file tree, syntax-free but reliable textarea editor with save, project-wide regex
search with `path:line` results, dev-server log view.

**History** — commit list, per-commit diffs, working-tree diff, restore-to-commit, revert working tree.

**Image generation** — optional OpenAI-compatible image model with an `image_generation` tool that
saves real artwork into the project instead of SVG placeholders. Falls back to the text endpoint and
reports a precise error when nothing can serve images.

**Providers** — OpenAI-compatible `/chat/completions`, Anthropic Messages, and an offline `mock`
provider for UI work without burning tokens. Connection test for both text and image endpoints.

**Desktop** — Electron wrapper that runs the server in-process, lives in the tray, and packages to an
NSIS installer.

## What it deliberately is not

| Not included | Why |
|---|---|
| Multi-tenancy, accounts, auth | Single user on a single machine. The control server binds `127.0.0.1` only. |
| Billing, quotas, metering | You bring your own API key; the provider meters you. |
| CDN, hosting, deploy targets | Projects are folders on disk. Export a zip and deploy it yourself. |
| Collaboration, comments, sharing | Out of scope for a local tool. |
| A bundled model | No local runtimes are probed or installed. Model access is API-only. |
| A database | State is JSON files under `data/` plus each project's git repo. |

## Security posture

- The HTTP server listens on `127.0.0.1` (`HOST` can change this) and has no authentication — treat
  it as a local-only tool, not something to expose on a network.
- Every file tool resolves paths through `resolveInside(root, candidate)` and refuses anything that
  escapes the project directory.
- `run_command` is allowlisted: npm/npx/pnpm/yarn package and script operations, `node` on a project
  script, `tsc`, and read-mostly git. Anything else is refused with an explanation rather than run.
  Because the command goes through a shell, **every** `;`/`&`/`|`-separated segment is checked and
  command substitution or redirection is refused outright, so a permitted prefix cannot carry a
  permitted-looking request into an unpermitted command.
- Project processes get a scrubbed environment. `npm install`, `node` on a project script, the dev
  server and MCP connectors see only what they need to run — `PATH`, home and temp directories, locale,
  proxy and CA configuration, `npm_config_*` — and never the platform's API keys or the credentials in
  the shell that started it. A dependency's postinstall script is untrusted code, so this is a
  boundary, not a convenience. Opt a specific name back in with `LOVABLE_CHILD_ENV`.
- Exported ZIPs skip `.env` and `.env.*` (`.env.example` is kept), so sharing a project cannot carry a
  secret the agent wrote.
- API keys live in `data/settings.json` (plaintext, local) or come from the environment. Keys that
  came from the environment are never written back to disk, and the API always returns them masked.
- `data/` is git-ignored. It holds keys, chat history and your generated projects.

## Technology choices

- **Server:** Node ESM, `node:` built-ins only. Zero runtime dependencies — no install step, no
  supply chain, no version drift. `http`, `fs/promises`, `child_process`, `crypto`, `zlib`.
- **Frontend:** vanilla JS, one HTML file, one CSS file, one module. No build step; the server
  serves `web/` directly. What you edit is what runs.
- **Generated projects:** Vite 8 + TypeScript + Tailwind CSS 4 (via `@tailwindcss/vite`, so there is
  no `tailwind.config.js`). React 19 or Vue 3.
- **Desktop:** Electron, imported in-process so no second Node install is needed.

See [Architecture](03-architecture.md) for how these pieces connect.
