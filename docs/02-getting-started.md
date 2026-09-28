# 2 · Getting started

## Requirements

| Need | Version | Notes |
|---|---|---|
| Node.js | ≥ 20.10 | `AbortSignal.any`, `fs/promises`, built-in `fetch` are all used. |
| npm | ships with Node | Used by generated projects and by `run_command`. |
| git | any recent | Each project is a real repo; commits, diffs and restore all shell out to it. |
| A model API key | — | Any OpenAI-compatible `/chat/completions` endpoint, or Anthropic. |

No `npm install` is needed to run the server or the web UI — they have no runtime dependencies.
`npm install` **is** needed once if you want the Electron desktop app or the installer
(`electron` and `electron-builder` are devDependencies).

## Run from source

```bash
git clone https://github.com/aminahmad2009/lovable-clone.git
cd lovable-clone
npm start                    # → http://127.0.0.1:4310
```

`npm run dev` does the same with `node --watch`, so server edits reload automatically.

The startup banner confirms the build identity and configuration:

```
  Stillworks v0.2.0 — built by CodeWoxy
  product id      codewoxy-stillworks
  control panel   http://127.0.0.1:4310
  data directory  D:\test-projects\lovable\data
  provider        openai (key configured)
  image model     not configured (image_generation falls back to the text endpoint)
  dev servers     ports 5180+, max 0 tracked
```

Open the control panel URL, click **New project**, name it, pick a template, and start typing in the
chat panel. The dev server starts on the first turn; the preview fills in once Vite is up.

## Run as a desktop app

```bash
npm install                  # once, for electron + electron-builder
npm run desktop              # dev: window + in-process server, data in ./data
npm run dist:win             # produce release/Stillworks-Setup-0.2.0.exe
```

The packaged app stores its data in `%APPDATA%/Stillworks/data` instead of the repository, so an
installed build never writes inside `Program Files`. See
[Desktop app & packaging](08-desktop-and-packaging.md).

## Configuration

Everything is optional — the Settings panel writes to `data/settings.json`, and environment
variables override it. Environment wins so a headless or scripted run needs no UI at all.

| Variable | Effect |
|---|---|
| `PORT` | Control-server port (default `4310`). |
| `HOST` | Bind address (default `127.0.0.1`). |
| `LOVABLE_DATA_DIR` | Where registry, settings, projects and history live (default `<repo>/data`). |
| `PROJECT_PORT_START` / `PROJECT_PORT_END` | Dev-server port range (default `5180`–`5380`). |
| `MAX_RUNNING_SERVERS` | Cap on concurrent dev servers (default `4`). |
| `LOVABLE_CHILD_ENV` | Comma-separated names to add to the scrubbed environment handed to `npm`, project scripts and MCP connectors. Only needed when a build genuinely requires a variable that is not `PATH`/home/proxy config. |
| `OPENAI_API_KEY` | Key for the OpenAI-compatible provider, used when Settings is blank. |
| `OPENAI_BASE_URL` | Base URL for that provider (e.g. an NVIDIA or Groq endpoint). |
| `OPENAI_MODEL` | Default model name. |
| `ANTHROPIC_API_KEY` | Key for the Anthropic provider. |
| `ANTHROPIC_BASE_URL` | Anthropic-compatible gateway URL. |
| `ANTHROPIC_AUTH_TOKEN` | Gateway token — **only** honoured together with `ANTHROPIC_BASE_URL`. |
| `ANTHROPIC_MODEL` | Default Anthropic model. |
| `IMAGE_API_KEY` | Key for the image endpoint (blank → reuse `OPENAI_API_KEY`). |
| `IMAGE_BASE_URL` | Image endpoint base (blank → reuse `OPENAI_BASE_URL`). |
| `IMAGE_MODEL` | Image model name. Setting this alone enables `image_generation`. |
| `IMAGE_SIZE` | Default image size (e.g. `1024x1024`). |

`ANTHROPIC_AUTH_TOKEN` is ignored unless `ANTHROPIC_BASE_URL` is also set: sending a gateway token to
`api.anthropic.com` produces a confusing 401, so the code refuses to set that trap.

### Settings precedence

```
DEFAULT_SETTINGS  <  data/settings.json  <  environment variables
```

Merging is deep, so setting `OPENAI_MODEL` only changes the model and leaves your stored base URL
alone. A base URL from the environment is only used when you have not stored one — your explicit
choice in the UI always beats the environment for URLs, while keys and model names let the
environment win when the stored field is blank.

## First project, step by step

1. **New project** → name it → template `React + Vite + Tailwind` → Create.
2. The dev server starts and the preview shows the scaffold.
3. In chat, keep **Agent** mode and type something concrete:
   `Build an invoice tracker with a list view, an add-invoice form, and totals. Use localStorage.`
4. Watch the chat: a Thinking block (collapsible), then text, then tool cards for each file written,
   then the preview hot-reloading.
5. When the turn ends, the commit appears in the **History** tab and the step/token totals appear
   under the chat input.
6. Switch to **Plan** mode when you want to discuss an approach without any file being touched.

## Useful defaults to know about

- **Auto-install** is on: when the agent edits `package.json`, `npm install` runs automatically
  before the next step, so new imports resolve.
- **Auto-commit** is on: one commit per turn. Turn on **Review changes before committing** in
  Settings to get an approve/revert bar instead.
- **Max steps per turn** defaults to 24 and is adjustable from 4 to 60. Hitting it is reported in
  chat, not silently.
- **Mock provider** (`Settings → Provider → mock`) returns scripted responses with no API calls.
  A banner in the chat panel reminds you it is active. Use it for UI work offline.

## Where things live

| Path | Contents |
|---|---|
| `server/` | Control server, agent, tools, registry, dev-server manager, LLM adapters. |
| `server/templates/` | Scaffold sources for the project templates. |
| `web/` | The control panel: `index.html`, `app.js`, `styles.css`. Served as-is. |
| `electron/` | Desktop wrapper (`main.js`, `preload.cjs`). |
| `build/` | Installer resources (icon). |
| `docs/` | These documents. |
| `data/` | **Runtime, git-ignored.** `settings.json`, `registry.json`, `skills.json`, `projects/<slug>`, `meta/<id>/history.json`. |
| `release/` | **Build output, git-ignored.** Installers and unpacked app. |

Next: [Architecture](03-architecture.md).
