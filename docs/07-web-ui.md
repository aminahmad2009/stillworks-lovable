# 7 · Web UI guide

The panel is a single page (`web/index.html`, `web/app.js`, `web/styles.css`) with no build step and
no dependencies. Layout: **sidebar** (projects) · **main** (preview / code / history / logs) ·
**chat** (right). Below ~1180 px the chat becomes a slide-over.

## Sidebar

- **Brand** — `Stillworks`, `by CodeWoxy · single-user · on-device`.
- **New project** — modal with a name and template choice (React or Vue). The folder is created under
  `data/projects/` with its own git repo and a reserved port.
- **Import folder…** — adopts an existing Vite project *in place*; nothing is copied. Git is
  initialised if missing so history and rollback work. The preview only starts if the folder really
  is a Vite project.
- **Projects list** — live status dot per project (stopped / starting / installing / running /
  error), slug and port, "updated N ago". Status updates arrive over SSE even for projects you are
  not viewing.
- **Provider pill** — `openai · ready` or `openai · no key`, with `· 🖼` appended when an image
  model resolves. The tooltip names the image model.
- **Version chip** (`v0.2.0`) — opens the About panel.
- **Settings** and **theme toggle** (light/dark, persisted locally).

### About panel

Product name and version, publisher, and a definition list: Product ID, Version, Built by, text
provider and readiness, image model, project/server counts, app directory, data directory. A
Repository link appears when `package.json` declares one. The data is re-fetched from `/api/health`
each time it opens, so it always describes the running build.

## Home

The empty state: a headline, a create-project form, and a grid of project cards (status dot, slug and
port, last update). Creating from here behaves exactly like the sidebar modal. Each card carries
**Open**, **Rename** (display name only — the slug and folder never move) and **Remove**.

Below the grid, a leftovers panel appears only when there is something to report: folders under
`data/projects/` that no list entry points at, each with **Adopt** (register it in place) and **Move
to trash**, and a **Trash** group listing what is waiting there with **Empty trash** for the permanent
step.

An amber banner above the grid states any startup blocker in plain words — `git` or `npm` missing from
PATH, or a `registry.json` written by a newer build — rather than letting the first scaffold fail.

## Workspace header

Project name; status pill; port; cumulative tokens for the project; the project path. Then tabs and
actions:

- **← Projects** — back to the home grid. The dev server keeps running; nothing is torn down.
- **Typecheck** — runs `npm run typecheck`, streams output to Logs, toasts pass/fail.
- **Restart** / **Stop** — dev-server control.
- **Open ↗** — the preview in a real browser tab (in Electron this goes to the system browser rather
  than a bare child window).

## Preview

Device-width chips (Mobile 375 / Tablet 768 / Full), the live URL, and Reload. The iframe is
sandboxed with `allow-scripts allow-same-origin allow-forms allow-popups allow-modals`. An overlay
covers it while the server is starting or installing dependencies, with a spinner and a status line.

A collapsible **Console** strip captures the preview's console output and error count; the badge
lights up when errors arrive while you are on another tab.

## Code

File tree on the left (with a refresh button), editor on the right. The tree hides `node_modules`,
`.git`, `dist` and friends. A search box runs a project-wide regex and lists `path:line` hits;
clicking one opens that file. Beneath the tree sit **Export ZIP** — the project as a zip, minus
`node_modules`, `.git` and `dist` — and **Remove project…**, which removes the current project from
the list without leaving the workspace.

The editor is a plain textarea with an "unsaved" indicator and a Save button (`PUT …/file`). Saving
emits `file:written`, which the preview picks up through Vite's own HMR.

## History

Commits on the left, diffs on the right. Selecting a commit shows its diff; **Working tree** shows
uncommitted changes. **Restore commit** hard-restores the tree to the selected commit (with a confirm
dialog). This is the rollback path for a bad turn.

Under the commit list a remote row reports where `origin` points. **Set remote** stores one (`https://`,
`ssh://`, `file://` or `git@…`) and **Push** sends the current branch to it; with no remote the row reads
*no remote*, Push stays disabled and the history exists only on this machine.

## Logs

Raw dev-server output, newest at the bottom, with a Clear view button. The tab badge counts stderr
lines while you are elsewhere.

## Chat

- **Plan / Agent** switch. Plan mode sends no tools; the agent discusses instead of editing, and the
  system prompt explicitly forbids claiming it changed files.
- **🎨 Design** — pick a visual starting point from the preset library (searchable). Applied per
  project and injected into the system prompt. **No style** clears it.
- **🧩 Skills** — toggle built-in skills or add your own. The trigger shows `Skills · N` where N
  counts only skills that still exist. The editor takes an icon, name, description, tags and the
  instructions text that gets injected. Built-ins cannot be edited or deleted; deleting a user skill
  also removes it from any project that had it enabled.
- **Stop** — aborts the in-flight turn (visible only while running).
- **Clear** — wipes the transcript.
- **🖼** — attach up to 8 reference images; they are sent as base64 image blocks to vision-capable
  models.
- Input: **Enter** sends, **Shift+Enter** inserts a newline. Under the input: a hint line and, after
  a turn, `N steps · <input>↑ <output>↓`.

### What a turn looks like

1. Your message.
2. A **Thinking** card: an arrow, a label, and animated dots while it streams. Click to expand the
   reasoning. When it finishes the label becomes `Thought for Ns`, the dots stop, and it collapses.
   Reloaded history replays these blocks collapsed.
3. Answer text streaming in.
4. A **tool card** per call: name, arguments (long strings truncated), streaming command output, and
   a green/red final state with the result text.
5. System lines for retries, self-healing, notices, and the step cap.
6. Either a success (commit toast, usage line) or a red **error message** with the reason and a hint.

Errors are first-class messages, not toasts: they stay in the transcript, and the failure is also
written into history as `_(error: …)_` so it survives a reload.

## Settings

Provider radio (openai / anthropic / mock). The OpenAI block has a Preset dropdown that fills base
URL and model, plus API key, base URL and model. The Anthropic block has the same three fields.
Key fields are blank on open with a placeholder telling you whether a key is already stored —
leaving them blank keeps the existing key.

The preset list leads with **Pollinations.ai** (`https://gen.pollinations.ai/v1`, default model
`deepseek/deepseek-v4-flash`), then OpenAI, OpenRouter, Groq, Together AI, Azure and a blank custom
endpoint.

In the modal footer, **Download diagnostics** saves a single JSON file describing the install — app
identity and paths, OS and Node versions, the git/npm probe, the registry, running-server log tails and
the settings block with every key masked. It is the attachment for a support request; nothing else
about this app leaves the machine.

**Image model** block: optional key (blank reuses the text provider's), optional base URL (blank
reuses the text provider's), model name, and a default size dropdown. A one-line status says whether
an image capability is active and which endpoint it resolved to.

**Agent**: auto-install, auto-commit, review-before-commit, and a max-steps slider (4–60) with a live
value readout.

**Test connection** saves the form first, then makes a 16-token call and reports provider, latency,
model and the reply — or the status, message and hint. **Test image model** does the equivalent for
the image endpoint with a 256×256 throwaway image.

A note in the modal records that keys live in `data/settings.json` on this machine only and lists the
environment variables that are also read.

## Toasts and confirmations

Transient toasts (bottom-right) report success and failure of discrete actions. Destructive actions —
removing a project, deleting a skill, restoring a commit, reverting the working tree — go through a
confirm dialog that states exactly what will be removed. Removing a project is offered from the home
cards and from **Remove project…** under **Export ZIP** in the Files sidebar; both unregister the
project and stop its dev server, and only move the folder to `data/.trash/` when the dialog's checkbox
is ticked. Emptying the trash is the one action with no way back, and says so.
