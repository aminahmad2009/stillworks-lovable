# 3 · Architecture

## Process model

```
┌───────────────────────────────────────────────────────────────────┐
│ Control server process (node server/index.js, or Electron main)   │
│                                                                   │
│  http server :4310 ── routes ── registry / agent / files / git    │
│         │                        │                                │
│         │                        └── devserver manager            │
│         │                              │  spawn                    │
│  SSE bus (EventEmitter)                ▼                          │
│         ▲                        ┌──────────────┐ ┌────────────┐  │
│         └── emit(projectId,…)    │ vite :5180   │ │ vite :5181 │  │
│                                  └──────────────┘ └────────────┘  │
└───────────────────────────────────────────────────────────────────┘
              ▲ HTTP + SSE                    ▲ iframe
              │                               │
        ┌─────┴───────────────────────────────┴─────┐
        │ Browser / Electron renderer (web/app.js)  │
        └───────────────────────────────────────────┘
```

One long-lived Node process owns everything. Vite dev servers are child processes, one per running
project, killed on `SIGINT`/`SIGTERM` and on Electron `before-quit`.

In the desktop build the server is **imported in-process** (`await import('../server/index.js')`)
rather than spawned, so it shares Electron's V8 and Node runtime and needs no separate Node install.
Environment variables are set *before* the dynamic import because `server/config.js` reads them at
module-evaluation time.

## Module map

| File | Lines | Responsibility |
|---|---|---|
| `server/index.js` | ~750 | HTTP server, route table, static file serving, SSE endpoints, settings redaction, chat orchestration, shutdown. |
| `server/config.js` | ~200 | Paths, ports, build identity (`APP_VERSION`, `PRODUCT_ID`, `COMPANY`), default settings, layered load/save, key-source detection, presets. |
| `server/registry.js` | ~310 | Project records: create, import, rename, delete, list, port allocation, design/skill assignment, usage totals, chat history persistence. |
| `server/scaffold.js` | ~100 | Copies a template into a new project folder and initialises git. |
| `server/devserver.js` | ~350 | Per-project child process lifecycle, port probing, log ring buffer, build-error detection, the event `bus` and `emit()`. |
| `server/agent.js` | ~510 | The turn loop, system prompt assembly, retry policy, tool dispatch, self-healing, commit step, terminal-event contract. |
| `server/tools.js` | ~390 | Tool definitions and handlers, path-escape guard, command allowlist, image tool. |
| `server/prereqs.js` | ~50 | One-shot `git`/`npm` probe with human-readable results for health, boot log and the panel banner. |
| `server/files.js` | ~170 | Tree listing, file read/write for the editor, regex search. |
| `server/git.js` | ~120 | `status`, `log`, `diff`, `show`, `restore`, `commit -A`, discard. |
| `server/designs.js` | ~145 | Built-in design preset catalogue and per-design prompt briefs. |
| `server/skills.js` | ~260 | Built-in + user skills, CRUD, prompt brief assembly. |
| `server/zip.js` | ~120 | Dependency-free zip writer for project export. |
| `server/llm/index.js` | ~65 | Adapter registry, provider resolution, readiness check, connection test, single `streamChat` entry point. |
| `server/llm/openai.js` | ~210 | OpenAI-compatible streaming adapter, including reasoning-delta extraction and message translation. |
| `server/llm/anthropic.js` | ~190 | Anthropic Messages streaming adapter. |
| `server/llm/mock.js` | ~75 | Scripted offline provider. |
| `server/llm/image.js` | ~255 | OpenAI-compatible image generation: capability resolution, request, fallback chain, connection test. |
| `server/llm/sse.js` | ~90 | Shared SSE framing parser and `assertOk` error translator. |
| `web/app.js` | ~2200 | The entire control panel: state, rendering, SSE handling, modals, editor, preview. |
| `electron/main.js` | ~200 | Window, tray, single-instance lock, port discovery, in-process server, shutdown. |

## Data flow: one chat turn

```
1  POST /api/projects/:id/chat { message, mode, images }
2  ├─ reject if a turn is already active for this project (409)
3  ├─ loadSettings(); reject with 400 { needsKey: true } if no key for the provider
4  ├─ create AbortController, register in activeTurns
5  ├─ emit turn:queued  ─────────────────────────────▶ UI disables the input
6  └─ respond 202 { accepted: true } immediately
7  manager.get(project).start()          # preview must be live so build errors feed back
8  runAgentTurn(...)
9    ├─ listProjectTree, loadHistory, skillsBrief, imageBrief
10   ├─ emit turn:start
11   └─ loop while steps < maxSteps:
12        streamChat → onText/onThinking/onToolStart emit as deltas arrive
13        ├─ empty response?  retry twice (emit system:notice), then emit turn:error and return
14        ├─ no tool calls (or plan mode)? break
15        └─ for each tool call: emit tool:args → executeTool → emit tool:end
16           feed results back as a tool_result user message
17           if the dev server reports a build error → inject it and emit agent:selfheal
18           if package.json changed and autoInstall → npm install, inject the output
19   post-loop: addProjectUsage → commit or review:pending → appendHistory → touchProject
20   emit turn:end { steps, usage, commit }
```

Every arrow above is an SSE event on `GET /api/projects/:id/events`. The browser never polls.

## State and storage

There is no database. All state is files:

```
data/
├── settings.json          provider keys, base URLs, models, image config, agent flags
├── registry.json          project records: id, name, slug, path, port, template,
│                          designId, skillIds, usage totals, timestamps
├── registry.json.bak      mirror of the last complete registry write
├── skills.json            user-defined skills (built-ins live in code)
├── meta/<project-id>/
│   └── history.json       { messages: [...], updatedAt } — capped at the last 400
├── projects/<slug>/       the actual app, with its own .git
└── .trash/<slug>-<iso>/   folders a removal gave up on; cleared only by "Empty trash"
```

Writes go through `writeJsonAtomic` (write to a temp file, then `rename`) so a crash mid-write cannot
corrupt a registry or settings file. Every registry write then mirrors the result to
`registry.json.bak`, and a `registry.json` that exists but will not parse is recovered from that mirror
on the next read rather than booting with an empty project list.

Removing a project never deletes its folder by itself: the registry entry and `meta/<id>/` go, and the
working directory moves to `.trash/` only when removal is asked to take files.

A `registry.json` whose `version` is higher than the running build understands is kept **read-only**:
reads continue so the owner can upgrade, but every write throws instead of rewriting the file in an
older shape.

Project records are keyed by a UUID; the slug is only for humans and for the folder name. Routes
accept either form and resolve through `getProject(idOrSlug)`.

## Message format

Internally, conversations use **Anthropic-shaped content blocks**, regardless of provider:

```js
{ role: 'user' | 'assistant', content: [
  { type: 'text',      text },
  { type: 'thinking',  thinking },          // persisted for replay, never sent back
  { type: 'image',     source: { type: 'base64', media_type, data } },
  { type: 'tool_use',  id, name, input },
  { type: 'tool_result', tool_use_id, content, is_error },
]}
```

Each adapter translates to and from its provider's wire format. Unknown block types are dropped when
rebuilding a request, which is what makes it safe to persist `thinking` blocks for the UI without
leaking reasoning back into the model's context.

History is trimmed to the last 24 turns before being sent, and trimming never leaves a leading
`tool_result` (it would reference a `tool_use` that was dropped, which Anthropic rejects).

## Event bus

`server/devserver.js` exports a single `EventEmitter` (`bus`) and `emit(projectId, type, payload)`.
Every payload is stamped with `projectId` and a timestamp. Two SSE endpoints expose it:

- `GET /api/events` — everything, all projects (used to keep the sidebar status live).
- `GET /api/projects/:id/events` — filtered to one project.

A heartbeat comment is written every 25 s to keep proxies and idle sockets from closing the stream,
and the client reconnects after 2.5 s if it drops.

## Error-handling contract

Three rules keep failures visible:

1. **Tools never throw.** `executeTool` catches everything and returns a string; failures start with
   `ERROR:` or `Refused:` so the agent (and the UI) can tell success from failure by prefix.
2. **A turn always ends with exactly one terminal event** — `turn:end`, `turn:error` or
   `turn:aborted`. The agent tracks this with a guard so a late throw cannot double-emit, and the
   HTTP route re-emits `turn:error` as a safety net if the agent threw without reporting.
3. **API errors carry a status.** `assertOk` turns a non-2xx provider response into an `Error` with
   `.status`, `.provider` and a `.hint` for 401/403/429, which the retry logic and the UI both use.

See [Agent loop & tools](04-agent-and-tools.md) for the details.
