# 4 · Agent loop & tools

## The turn lifecycle

`runAgentTurn()` in `server/agent.js` owns one turn end to end.

```
setup      listProjectTree → loadHistory → skillsBrief → imageBrief → systemPrompt
start      emit turn:start
loop       while steps < maxSteps and not aborted:
             streamWithRetry(...)                      # model call, with backoff
             ├─ empty response  → retry ≤2, then turn:error and return
             ├─ plan mode or no tool calls → break
             └─ execute each tool call, push tool_results back into the message list
                ├─ dev server in error state → inject the build error (once per turn)
                └─ package.json changed → npm install, inject the output
finish     addProjectUsage → commit (or review:pending) → appendHistory → touchProject
           emit turn:end { steps, usage, commit, aborted }
```

### Terminal-event contract

The single most important invariant: **a turn always emits exactly one of `turn:end`, `turn:error`,
`turn:aborted`.** Two closures enforce it:

```js
const terminal = { done: false }
const fail   = (message, extra) => { if (terminal.done) return false; terminal.done = true; emit(…, 'turn:error', …); return true }
const finish = (payload)        => { if (terminal.done) return false; terminal.done = true; emit(…, 'turn:end', payload); return true }
```

The whole body runs inside a `try`. The `catch` distinguishes an abort (emit `turn:aborted`, return
`{ aborted: true }`) from a real failure (persist `_(error: …)_` into history, `fail(…)`, mark
`err.emitted = true`, rethrow). `server/index.js` checks that flag and only emits its own safety-net
`turn:error` when the agent did not already report one.

This exists because a throw *after* the model loop — a history write, a usage write — used to reach
the route handler, get logged to the console, and leave the chat panel with no message at all. That
was the "agent stopped without an error" bug.

### Empty responses

A model can return a 200 with no content and no tool calls: reasoning-only output truncated by the
token limit, a content filter, a mis-set model name, a gateway that swallowed the stream. The old
code simply `break`ed, emitting `turn:end` with nothing in it. Now:

1. The response is retried up to `EMPTY_RESPONSE_RETRIES` (2) times with a short delay, emitting a
   `system:notice` line in chat so the retry is visible. Retries do not consume a step.
2. If it is still empty, `emptyResponseError()` builds a specific message from the stop reason and
   whether reasoning was streamed:

| Situation | Message |
|---|---|
| Reasoning but no answer | `<model> streamed reasoning only — no answer text and no tool calls (stop reason: length).` |
| `stop_reason: length` | `<model> hit its output token limit before producing any content (stop reason: length).` |
| `content_filter` | `<model> returned an empty response because the provider filtered it (stop reason: content_filter).` |
| Anything else | `<model> returned an empty response — no text and no tool calls (stop reason: stop).` |

Each carries a `hint` (retry, shrink the request, check the model name). The failure is persisted to
history as `_(error: …)_` so it is still there after a reload.

### Retry policy

`streamWithRetry` retries on HTTP 429, any 5xx, an error code in `TRANSIENT_CODES`
(`ECONNRESET`, `EPIPE`, `ETIMEDOUT`, `EAI_AGAIN`, `UND_ERR_SOCKET`, `UND_ERR_CONNECT_TIMEOUT`,
`UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`), or a message matching
`overloaded|rate limit|too many requests|temporarily unavailable|service unavailable|connection reset|ECONNRESET`,
with delays of 6 s then 15 s, emitting `agent:retry` each time so the UI can say what is happening.
An aborted signal stops retrying immediately. The code check matters because transport errors are
translated into sentences before they get here, so the wording no longer contains the raw code.

### Transport error translation

Every adapter funnels its `fetch` and its SSE body iteration through `describeNetworkError()`
(`server/llm/sse.js`). Node reports transport failures as a bare `fetch failed` with the reason on
`err.cause`; the translator turns that into a sentence naming the host plus an actionable `hint`,
which the UI prints under the error. `AbortError` (the user pressed **Stop**) and any error that
already carries a `status`/`hint` from `assertOk` pass through untouched, so translation can never
mask an HTTP error or mislabel a deliberate stop. See
[10-troubleshooting.md](10-troubleshooting.md#network-failures-say-what-failed) for the full table.

### Step cap

`settings.agent.maxSteps` (default 24, UI range 4–60). Reaching it emits `turn:maxsteps` — a notice
the UI renders as *"Reached the N-step limit. Send another message to continue."* — and then still
closes the turn normally with `turn:end`, so partial work is committed and the UI unlocks.

### Self-healing

After each batch of tool calls the agent checks `manager.peek(project.id)`. If the dev server has
flipped to `error` with a `lastError`, that compiler output is injected as a user message
(`"The dev server reported a build error after your changes: … Fix it now."`) and
`agent:selfheal` is emitted. This happens at most once per turn to avoid loops.

### Auto-install

If any mutated path ends with `package.json` and `agent.autoInstall` is not false, `npm install
--no-audit --no-fund` runs and its tail is injected as a user message, so the next step can import
the new dependency. `deps:changed` is emitted so the preview reloads.

### Commit step

- `agent.reviewCommit === true` → nothing is committed; `review:pending` lists the changed files and
  the UI shows an approve / revert / view-diff bar.
- otherwise, if `agent.autoCommit !== false` → `git add -A` + commit with a message derived from the
  user's prompt (first 72 characters) and up to eight changed file paths. `git:commit` is emitted.
- Git failures emit `git:error` and never fail the turn — your edits are more important than the
  commit.

## System prompt

Assembled per turn from: framework notes (React or Vue), Tailwind 4 wiring rules, project
conventions, hard rules, the selected design brief, enabled skill briefs, the image-generation brief,
and the current file tree. Plan mode replaces the tool instructions with "you have no tools and must
not claim to have changed files".

Rules worth knowing because they explain agent behaviour:

- Never leave TODOs, placeholders or stubs.
- Prefer `edit_file` with exact text over rewriting a file.
- Read before editing; never guess indentation.
- Never run `npm run dev`, `vite` or any long-lived server — the platform already runs one, and a
  second would collide on the port.
- Never run `git commit` — the platform commits.
- Always end the turn with a short text reply; an empty reply is treated as an error.

## Tool reference

Eight tools, all dispatched through `executeTool(name, args, ctx)` where
`ctx = { root, onLog, settings, provider, signal }`. Handlers never throw; they return a string, and
failures are prefixed `ERROR:` (with a `Hint:` line appended when the error carries one) or
`Refused:`. The agent treats either prefix as failure.

### `list_files`
`{ path? }` — recursive tree from the project root (or a subdirectory), depth-capped at 8, hiding
`node_modules`, `.git`, `dist`, `.vite`, `.cache`, `coverage`. Directories get a trailing `/`, files
get their byte size. Truncates at 400 entries.

### `read_file`
`{ path, withLineNumbers? }` — returns the file with 4-column line numbers and tab separators by
default (set `withLineNumbers: false` for raw content). Truncates at 400 KB with a note about how
much was cut. Errors if the file does not exist.

### `write_file`
`{ path, content }` — creates parent directories, writes UTF-8, reports `Created` vs `Updated` with
the character count. Use for new files and complete rewrites.

### `edit_file`
`{ path, old_string, new_string, replace_all? }` — exact string replacement. Fails with a helpful
message when `old_string` is absent (*"Read the file first and copy the exact text including
indentation"*) or ambiguous (reports the match count and suggests `replace_all`). This is the
preferred tool for changes to existing files because it sends a diff, not a whole file.

### `delete_file`
`{ path }` — removes a file or directory recursively. No-ops with a message if it does not exist.

### `search_files`
`{ pattern, filePattern?, ignoreCase? }` — regex over file contents, skipping files larger than
2 MB, returning `path:line: trimmed content`, capped at 120 matches.

### `run_command`
`{ command }` — runs in the project root with `shell: true`, a 180 s timeout, `FORCE_COLOR=0`, and
streamed output (`tool:log` events). Output is capped at the last 60 KB while streaming and the last
12 KB in the final result, prefixed with the exit code.

**Allowlist.** Only these patterns execute; everything else returns a `Refused:` explanation instead
of running:

```
npm   install|i|ci|run|ls|list|view|uninstall|update|audit|init|test
npx   vite|tsc|tailwindcss|prettier|eslint
node  <path>.(js|mjs|ts)
git   status|diff|log|add|commit|show|restore|checkout
tsc
pnpm  install|add|run|list
yarn  install|add|run|list
```

The agent has unrestricted write access inside the project, so the shell is the one place a hard
allowlist is worth the friction. Anything else must be run by you. Because the string is handed to a
shell, matching the start proves nothing about what follows: every `;`, `&`, `|` or newline-separated
segment must clear the allowlist too, and backticks, `$(…)` and `<`/`>` are refused outright rather
than parsed. One command per call.

The child process also gets `childEnv()` rather than `process.env` — the platform's API keys and the
launching shell's credentials stay out of reach of code the model wrote or a dependency's postinstall
script. See [Overview](01-overview.md) for the same boundary around the dev server and MCP connectors.

A refusal is returned as tool output, not thrown, so the turn continues. The message names the common
false start explicitly: `mkdir` is never needed because `write_file` and `edit_file` create every
missing parent directory themselves, and the same is stated in the system prompt's rules and the tool
description so the agent rarely asks in the first place.

### `image_generation`
`{ prompt, path?, size? }` — generates one image and saves it inside the project. See
[Providers, settings & image generation](05-providers-and-images.md#image-generation) for the
endpoint resolution order, the parameter-rejection retry, and the failure modes.

Default destination is `public/generated/<slug>-<base36 timestamp>.<ext>`, which Vite serves from the
site root, so the tool reply tells the agent to reference it as `/generated/<file>`. An explicit
`path` is resolved through the same escape guard as every other file tool.

## Path safety

Every file tool calls `resolveInside(root, candidate)`, which resolves against the project root and
throws if the relative path starts with `..` or is absolute. `../../evil.png` is refused, not
written.

## Context management

History is capped at 24 turns (`HISTORY_TURNS`) in both directions: only the last 48 messages are
sent, trimming forward past any leading `tool_result`. On disk, `history.json` keeps the last 400
messages. Tool output sent back to the model is the full string; the copy emitted to the UI is
truncated at 1200 characters, and `content` / `old_string` / `new_string` arguments are truncated at
400 characters in `tool:args` so a whole-file write does not flood the event stream.
