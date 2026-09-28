# 10 · Troubleshooting

## The agent stopped and I got nothing

This used to be possible; it is now a bug if you see it. Every turn ends with exactly one terminal
event. What each message means:

| Message in chat | Cause | Fix |
|---|---|---|
| `<model> returned an empty response — no text and no tool calls (stop reason: stop)` | The provider returned a 200 with an empty completion. Already retried twice. | Send again. If it repeats, the model name or base URL in Settings is wrong for that gateway. |
| `<model> streamed reasoning only — no answer text and no tool calls (stop reason: length)` | A reasoning model spent its whole output budget thinking. | Ask for a smaller change, or use a model with a bigger output budget. |
| `<model> hit its output token limit before producing any content` | `finish_reason: length` on the first token. | Same as above. |
| `<model> returned an empty response because the provider filtered it` | Content filter. | Rephrase. |
| `The turn completed but the conversation could not be saved: …` | `data/meta/<id>/history.json` is not writable. | Check disk space and permissions on the data directory. |
| Provider message such as `The model 'x' does not exist` | Passed straight through from the API. | Fix the model name in Settings. |

Server-side, the same failures are logged as `[agent] turn failed for <slug>: …`. If the chat shows
nothing at all, check that the SSE stream is connected — the browser console will show an
`EventSource` error, and the panel retries after 2.5 s.

### Network failures say what failed

Node's `fetch` rejects with the two words `fetch failed` and hides the real reason on `err.cause`,
which is useless in a chat panel. `describeNetworkError()` in `server/llm/sse.js` translates every
transport failure before it reaches you, and each translated error carries a `hint` that the UI
prints underneath:

| You see | Underlying code | Retryable |
|---|---|---|
| `Could not reach the OpenAI-compatible endpoint at <host> — the connection was refused.` | `ECONNREFUSED` | no — nothing is listening |
| `DNS lookup failed for <host>.` | `ENOTFOUND` | no |
| `Temporary DNS failure resolving <host>.` | `EAI_AGAIN` | yes |
| `The … endpoint at <host> did not accept the connection in time.` | `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT` | yes |
| `The … endpoint at <host> stalled before finishing the response.` | `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT` | yes |
| `The connection to <host> dropped mid-request.` | `ECONNRESET`, `EPIPE`, `UND_ERR_SOCKET` | yes |
| `TLS handshake with <host> failed (<code>).` | certificate errors | no — fix the chain, don't disable verification |
| `The … endpoint at <host> did not respond within the time limit.` | `TimeoutError` from the deadline signal | no |

"Retryable" means the agent retries after 6 s then 15 s and posts an `agent:retry` notice; the
codes above are the exported `TRANSIENT_CODES` set. A user-initiated **Stop** is an `AbortError` and
is passed through untranslated, so it can never be mistaken for a network fault. Errors that already
carry an HTTP status (`assertOk`) are also passed through untouched.

## Model and provider problems

**`No API key for "openai". Add one in Settings.`** — the key is blank and no `OPENAI_API_KEY` is set.
The Settings panel opens automatically.

**401 / 403 on Test connection** — wrong key, or a gateway token sent to the wrong host. Note that
`ANTHROPIC_AUTH_TOKEN` is deliberately ignored unless `ANTHROPIC_BASE_URL` is also set, precisely to
avoid a confusing 401 from `api.anthropic.com`.

**404 from an OpenAI-compatible endpoint** — the base URL usually needs `/v1` at the end
(`https://api.openai.com/v1`, `https://api.groq.com/openai/v1`). The adapter appends
`/chat/completions` to whatever you give it.

**429 / overloaded** — expected. The agent retries after 6 s then 15 s and says so in chat
(`agent:retry`). If every attempt fails, the error surfaces normally.

**Responses are scripted and repetitive** — the `mock` provider is selected. A banner in the chat
panel confirms it; switch back in Settings.

**Env var not taking effect** — environment beats `settings.json` for keys and model names, but a
base URL from the environment is only used when you have not stored one. Clear the Base URL field in
Settings to let `OPENAI_BASE_URL` apply.

## Image generation

**Tool returns `ERROR: Image generation failed.` with a list of attempts** — every configured
endpoint was tried and each line says why it failed. The two common cases:

- `no such route` / 404 → the endpoint does not expose `/images/generations`. Set a base URL for an
  image-capable gateway in Settings → Image model.
- `Incorrect API key` → the image endpoint needs its own key; the blank field inherits the text
  provider's, which may not be valid there.

**`ERROR: No image generation capability is configured.`** — no image model *and* no usable
OpenAI-compatible text endpoint (for example an Anthropic-only setup). Add a model in Settings →
Image model.

**A model that rejects `response_format`** — handled automatically: the request is retried once
without the offending parameter. If it still fails, the error text quotes the API response.

**The generated image does not show in the preview** — files must live under `public/` to be served
from the site root. The default path is `public/generated/<name>.png`, referenced in code as
`/generated/<name>.png`. If you passed a custom `path` outside `public/`, import it as a module
instead of referencing it by URL.

**Use Test image model** in Settings to isolate the problem: it reports the model, which endpoint
served it (`image model` vs `text model endpoint`), byte size and latency, or the full error.

## Dev server and preview

**Preview stuck on "Starting dev server…"** — open the Logs tab. First run does a full `npm install`,
which can take a minute or two. The status pill shows `installing` while it happens.

**Status pill red / build error in the preview** — the compiler output is fed back to the agent
automatically on the next turn (`agent:selfheal`), and it appears in Logs. You can also click Restart.

**Port already in use** — ports are allocated from 5180–5380 and probed before use. If a stray Vite
process from an earlier session holds a port, kill it or let the project take the next free port.

**Too many servers** — `MAX_RUNNING_SERVERS` (default 4) caps concurrency; older servers are stopped
to make room.

**Dev server survives closing the app** — should not happen: `before-quit` calls `manager.stopAll()`.
If you see orphans, `taskkill //IM node.exe` is too blunt — find the child by port with
`netstat -ano | grep 518`.

## Projects and files

**A tool returns `ERROR: Path escapes the project directory`** — working as intended. Every file tool
resolves through the project root and refuses `..` traversal.

**`Refused: "…" is not on the allowlist ("…" is not)`** — `run_command` only permits npm/npx/pnpm/yarn
package and script operations, `node` on a project script, `tsc`, and read-mostly git, and every
`;`/`&`/`|`-separated segment must clear it, so chaining a second command is refused even after a
permitted first one. Run anything else yourself in a terminal. If it was `mkdir`, that was never
needed: `write_file` creates parent directories, and the refusal tells the agent so it carries on in
the same turn instead of stalling.

**A build works in your terminal but fails in a project** — project processes get a scrubbed
environment, not yours, so a variable that build reads is missing by design. If a project genuinely
needs one, start the server with `LOVABLE_CHILD_ENV=THAT_VAR` or set it on the project. Secrets belong
in the project's own `.env` (Vite reads it), never in the platform's environment.

**Banner: "git and npm are not installed"** — checked at boot, not guessed. Stillworks shells out to
`git` for per-project history and to `npm` to install and run what the agent generates, so nothing works
without them. Install the missing tool, then restart: the probe runs once at startup and is reported by
`GET /api/health`.

**Banner: "registry.json is version N; this build writes version 1"** — the data directory was last
written by a newer Stillworks. The app keeps reading it but refuses every write, so it cannot downgrade
your project list. Upgrade the app; do not edit the file by hand.

**Support asked for a diagnostics file** — **Settings → Download diagnostics** writes one JSON bundle
(app and paths, OS/Node versions, prerequisite probe, registry, server log tails, masked settings). Keys
are masked by the same code the panel uses, and it is opt-in.

**Imported folder shows no preview** — the folder must be a Vite project. The registry adopts it, but
only starts a server when it recognises one.

**Folders listed under "On disk but not in the list"** — leftovers under `data/projects/` with no
registry record: a removal that kept the files, a manual copy, or a half-built scaffold. **Adopt**
registers the folder in place, **Move to trash** takes it out of the way. A folder owned by an
imported project is never listed, because imported projects are matched by absolute path.

**A folder disappeared after removing a project** — it is in `data/.trash/<slug>-<timestamp>`, not
deleted. Move it back under `data/projects/` (or somewhere else) and **Adopt** it. `Empty trash` is
what deletes permanently.

**Project list came up empty after a crash or a power cut** — `registry.json` was caught mid-write. The
next read restores `registry.json.bak`, the mirror of the last complete write, and logs
`recovered from registry.json.bak`. If both are gone, the projects are still on disk: re-add them with
**Import folder…**.

**History looks short** — the on-disk transcript is capped at the last 400 messages and only the last
24 turns are sent to the model. Older content is still in git.

## Desktop app

**Window opens blank** — the server did not become ready within 25 s. Check whether another instance
holds the port range; the app probes 4310–4369 and picks a free one.

**Installer build fails with "Access is denied"** — a running instance is locking
`release/win-unpacked`. Kill `Stillworks.exe`, delete `release/win-unpacked`, rebuild.

**Settings/projects are missing in the installed app** — packaged builds use
`%APPDATA%/Stillworks/data`, not the repository's `./data`. Dev and installed builds do not share
state. Point `STILLWORKS_DATA_DIR` at one location if you want them to.

**Upgraded from "Lovable Local" and the list looks wrong** — the first launch copies
`%APPDATA%/Lovable Local/data` into `%APPDATA%/Stillworks/data` and leaves the original alone. If the
copy looks incomplete, quit and copy the folder yourself: the old path is a full working state, and
nothing in the new build deletes it.

**No File/Edit/View/Window menu** — intentional. Everything is in the tray menu and the in-app UI;
clipboard shortcuts still work in inputs.

## Getting diagnostic information

```bash
curl -s http://127.0.0.1:4310/api/health          # version, product id, provider, image model, counts
curl -s http://127.0.0.1:4310/api/settings         # effective config, keys masked
curl -s http://127.0.0.1:4310/api/projects         # every project with live server state
curl -s http://127.0.0.1:4310/api/projects/<id>/logs
```

The About panel (sidebar version chip) shows the same identity plus both directories. Server logs go
to stdout: `[api]`, `[agent]`, `[desktop]`, `[shutdown]` prefixes.

Before reporting a bug, capture: the version chip value, the provider and model, the exact chat error
text, and the matching server log lines.
