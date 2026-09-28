# 6 · HTTP & SSE API reference

Base URL `http://127.0.0.1:4310`. All request and response bodies are JSON unless stated otherwise.
There is no authentication — the server binds loopback only.

Errors are `{ "error": "message" }` with an appropriate status, sometimes plus extra fields
(`needsKey: true` on a missing API key). Route handlers that throw produce a 500 with the message;
an unmatched `/api/` path produces `404 { error: "No route for METHOD /path" }`.

`:id` accepts either the project UUID or its slug.

## Health, settings, providers

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Build identity and live status. |
| GET | `/api/settings` | Effective settings with keys masked. |
| PUT | `/api/settings` | Deep-merge a patch; returns the new effective settings. |
| GET | `/api/providers` | Provider list, presets, image size presets, readiness, image capability. |
| POST | `/api/settings/test` | `{ provider? }` → 16-token chat round-trip. |
| POST | `/api/settings/test-image` | Generates a 256×256 test image. |

`GET /api/health`

```json
{
  "ok": true,
  "version": "0.2.0",
  "productId": "codewoxy-stillworks",
  "product": "Stillworks",
  "company": "CodeWoxy",
  "repository": "https://github.com/aminahmad2009/lovable-clone",
  "root": "D:\\test-projects\\lovable",
  "dataDir": "D:\\test-projects\\lovable\\data",
  "projects": 3,
  "running": 1,
  "prerequisites": {
    "git": { "ok": true, "command": "git", "version": "git version 2.50.1" },
    "npm": { "ok": true, "command": "npm.cmd", "version": "10.9.2" }
  },
  "registry": { "understoodVersion": 1, "readOnly": null },
  "provider": "openai",
  "providerReady": true,
  "imageReady": true,
  "imageModel": "flux-1-schnell"
}
```

`prerequisites` is probed **once at boot** (spawning `git`/`npm` on every poll would cost more than it
tells you) and drives the amber banner on the home grid when a tool is missing. `registry.readOnly` is
non-null when `registry.json` was written by a newer build — the app keeps reading it and refuses to
write it, so an old build can never downgrade a new install's project list.

`GET /api/diagnostics` — one JSON file describing the install, sent with
`content-disposition: attachment` so the browser downloads it. Contains app identity and paths, OS and
Node versions, a **fresh** prerequisite probe, the full registry, running-server log tails, per-project
git dirtiness, and the settings block. Every `apiKey` is masked by the same `publicSettings()` the
panel uses, so the file is safe to email; it is still opt-in, reached from **Settings → Download
diagnostics**.

`GET /api/settings` — each provider block carries `apiKey` (masked as `••••••••` when set, empty
otherwise), `hasKey`, and `keySource` (`settings` \| `environment` \| `none`).

`PUT /api/settings` — an `apiKey` containing `•` is discarded server-side, so posting back the masked
value never destroys the real key.

## Catalogues

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/templates` | Scaffold choices: `react-vite`, `vue-vite`. Filtered against the folders in `server/templates/`, so a template can never be offered before it is installed. |
| GET | `/api/designs` | Built-in design presets. |
| GET | `/api/skills` | Built-in skills first, then user skills. |
| POST | `/api/skills` | Create a user skill → `201`. Requires `name` and `brief` (else 400). |
| PUT | `/api/skills/:skillId` | Update a user skill. Built-ins return 400. |
| DELETE | `/api/skills/:skillId` | Delete a user skill. Built-ins return 400; unknown id returns 404. |

A skill is `{ id, name, icon, description, tags[], brief, builtIn? }`. `brief` is the markdown
injected into the system prompt when the skill is enabled.

## Projects

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/projects` | All projects with live dev-server state, plus running servers, orphan folders and trash contents. |
| POST | `/api/projects` | `{ name, template? }` → scaffold, git init, port assignment → `201`. |
| POST | `/api/projects/import` | `{ dir, name? }` → adopt an existing folder in place (git initialised if missing) → `201`. |
| GET | `/api/projects/:id` | One project with runtime state. |
| PATCH | `/api/projects/:id` | `{ name }` → rename. |
| DELETE | `/api/projects/:id` | Stop the server, abort any turn, drop the record and its chat history. `?files=1` also moves the folder to `data/.trash/`; the response says which happened. |
| PUT | `/api/projects/:id/remote` | `{ url }` → set `origin`. Only `https://`, `ssh://`, `file://` and `git@…` are accepted. |
| POST | `/api/projects/:id/push` | Push the current branch to `origin`. 400 when no remote is set. |
| PUT | `/api/projects/:id/design` | `{ designId \| null }` → assign a design preset. Unknown id → 400. |
| PUT | `/api/projects/:id/skills` | `{ skillIds: [] }` → replace the enabled set (deduplicated). |
| GET | `/api/projects/:id/status` | Runtime state plus `agentRunning`. |

### Leftover folders

`GET /api/projects` reports folders under `data/projects/` that no registry entry
points at (`orphans`, each `{ slug, path, updatedAt }`) and what currently sits in
`data/.trash/` (`trash`, each `{ name, path, deletedAt }`).

| Method | Path | Purpose |
|---|---|---|
| DELETE | `/api/orphans/:slug` | Move one leftover folder to the trash. Refuses a name that resolves outside `data/projects/`, or to a folder a listed project owns. |
| POST | `/api/trash/empty` | Delete every folder in the trash. The one irreversible call. |

Adopting a leftover folder is `POST /api/projects/import` with its `path`.

A public project record looks like:

```json
{
  "id": "0feade5f-…", "name": "Invoice Tracker", "slug": "invoice-tracker",
  "path": "D:\\…\\data\\projects\\invoice-tracker", "port": 5180,
  "template": "react-vite", "designId": null, "skillIds": ["responsive", "accessibility"],
  "usage": { "inputTokens": 48213, "outputTokens": 9120 },
  "status": "running", "previewUrl": "http://localhost:5180", "lastError": null,
  "createdAt": "…", "updatedAt": "…"
}
```

## Dev server

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/projects/:id/start` | Start (or install then start) → server snapshot. |
| POST | `/api/projects/:id/stop` | Stop the child process. |
| POST | `/api/projects/:id/restart` | Stop then start. |
| GET | `/api/projects/:id/logs` | Snapshot including the log ring buffer and `lastError`. |

## Files, search, git

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/projects/:id/tree` | File tree for the Code tab. |
| GET | `/api/projects/:id/file?path=` | Read one file. Missing `path` → 400. |
| PUT | `/api/projects/:id/file` | `{ path, content }` → write; emits `file:written`. |
| GET | `/api/projects/:id/search?pattern=&file=` | Regex search → `{ pattern, hits }`. |
| GET | `/api/projects/:id/git` | Commit log and working-tree summary. |
| GET | `/api/projects/:id/diff?ref=` | Diff of a commit, or the working tree when `ref` is omitted. |
| POST | `/api/projects/:id/commit` | `{ message? }` → commit everything; `{ committed: false, reason: 'no-changes' }` when clean. |
| POST | `/api/projects/:id/restore?` | `{ ref }` → hard-restore the working tree to a commit. |
| POST | `/api/projects/:id/revert` | Discard uncommitted changes. |
| POST | `/api/projects/:id/typecheck` | Run `npm run typecheck`, stream output as `log` events, emit `typecheck:done`. |
| GET | `/api/projects/:id/export` | The project as a `application/zip` download. Skips `node_modules`, `.git`, build output, and every `.env` file except `.env.example`. |

## Chat and history

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/projects/:id/history` | `{ messages }` — the persisted transcript. |
| DELETE | `/api/projects/:id/history` | Clear it; emits `history:cleared`. |
| POST | `/api/projects/:id/chat` | Start a turn. Returns `202 { accepted: true, mode }` immediately. |
| POST | `/api/projects/:id/abort` | Abort the active turn. 404 if none. |

`POST /api/projects/:id/chat` body:

```json
{ "message": "…", "mode": "agent" | "plan", "provider": "openai", "images": ["data:image/png;base64,…"] }
```

- A second concurrent turn for the same project → `409`.
- Empty message → `400`.
- No API key for the chosen provider → `400 { needsKey: true }`; the UI opens Settings.
- `images` accepts data URLs or raw base64 (or `{ mediaType, data }` objects), capped at 8, and is
  sent to vision-capable models as base64 image blocks.
- The real result arrives over SSE, not in the HTTP response.

## Events (SSE)

| Path | Scope |
|---|---|
| `GET /api/events` | Every project. Used to keep sidebar status live. |
| `GET /api/projects/:id/events` | One project only. |

Framing is `data: {json}\n\n` with a `retry: 2000` hint, a `hello` event on connect, and a
`: ping` comment every 25 s. Every payload carries `projectId` and a timestamp.

| Event | Payload | Meaning |
|---|---|---|
| `hello` | `{ at }` | Stream opened. |
| `project:created` | `{ name, slug, port }` | A project was created or imported. |
| `status` | `{ status, previewUrl?, lastError? }` | Dev server state: `stopped`, `starting`, `installing`, `running`, `error`. |
| `log` | `{ stream, line }` | A line of dev-server output (`stdout`, `stderr`, `system`). |
| `turn:queued` | `{ mode }` | A turn was accepted. |
| `turn:start` | `{ mode, model }` | The model call began. |
| `assistant:thinking` | `{ delta, step }` | A reasoning delta. |
| `assistant:delta` | `{ delta, step }` | An answer-text delta. |
| `assistant:text` | `{ text, step }` | The step's complete text. |
| `tool:start` | `{ id, name, step }` | A tool call began. |
| `tool:args` | `{ id, name, args }` | Its arguments (long strings truncated). |
| `tool:log` | `{ id, name, text }` | Streaming command output. |
| `tool:end` | `{ id, name, ok, result }` | Finished; `ok` is false for `ERROR:`/`Refused:` results. |
| `agent:retry` | `{ attempt, delayMs, message }` | Backing off after a provider throttle. |
| `agent:selfheal` | `{ error }` | A build error was fed back to the agent. |
| `system:notice` | `{ message }` | Non-fatal notice (empty-response retry, dev server failed to start). |
| `deps:changed` | `{}` | Dependencies were installed; the preview reloads. |
| `file:written` | `{ path, by }` | A file changed (`by`: `agent`, `user`, `restore`, `revert`). |
| `git:commit` | `{ hash, message, files }` | A commit landed. |
| `git:error` | `{ message }` | Committing failed; the turn still succeeds. |
| `review:pending` | `{ files[] }` | Changes are awaiting approval. |
| `design:changed` | `{ designId }` | The project's design preset changed. |
| `skills:changed` | `{ skillIds[] }` | The project's enabled skills changed. |
| `typecheck:done` | `{ ok }` | Typecheck finished. |
| `history:cleared` | `{}` | The transcript was cleared. |
| `turn:maxsteps` | `{ maxSteps }` | The step cap was reached. |
| `turn:aborted` | `{}` | The user stopped the turn. |
| `turn:error` | `{ message, hint?, empty?, stopReason? }` | The turn failed. Always terminal. |
| `turn:end` | `{ steps, usage, commit, aborted }` | The turn succeeded. Always terminal. |

Exactly one of `turn:end`, `turn:error`, `turn:aborted` closes every turn.

## Static files

Any non-`/api/` path is served from `web/`, with `index.html` as the SPA fallback. Responses are
`cache-control: no-store`, so a saved edit is visible on the next reload with no cache busting.
