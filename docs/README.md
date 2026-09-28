# Stillworks — Documentation

**Product ID:** `codewoxy-stillworks` · **Version:** 0.2.0 · **Built by:** CodeWoxy

Stillworks is a single-user, on-device prompt-to-app studio. You describe an app in
chat; an agent edits real files in a real project folder; a real Vite dev server renders it live in a
preview pane; every turn is committed to a real git history you can roll back.

There is no cloud, no tenancy, no billing and no CDN. Everything lives on one machine, and model
access goes through an OpenAI-compatible API you supply.

## Read in this order

| # | Document | What it covers |
|---|----------|----------------|
| 1 | [Overview](01-overview.md) | What the system is, what it deliberately is not, feature map |
| 2 | [Getting started](02-getting-started.md) | Requirements, running from source, first project, environment variables |
| 3 | [Architecture](03-architecture.md) | Process model, request/data flow, directory layout, module map |
| 4 | [Agent loop & tools](04-agent-and-tools.md) | The turn lifecycle, system prompt, tool reference, self-healing, the error contract |
| 5 | [Providers, settings & image generation](05-providers-and-images.md) | Adapters, settings layering, key handling, the image model and `image_generation` |
| 6 | [HTTP & SSE API](06-api-reference.md) | Every endpoint and every server-sent event |
| 7 | [Web UI guide](07-web-ui.md) | Each panel, what it does, keyboard behaviour |
| 8 | [Desktop app & packaging](08-desktop-and-packaging.md) | Electron wrapper, NSIS installer, data location |
| 9 | [Versioning & releases](09-versioning-and-releases.md) | Product ID, semver policy, changelog discipline, tagging |
| 10 | [Troubleshooting](10-troubleshooting.md) | Symptom → cause → fix for everything that commonly goes wrong |
| — | [Legal](../legal/README.md) | Draft EULA, terms of sale, privacy policy, refund policy — with the pre-publication checklist |

## Two-minute mental model

```
you ──▶ web UI (vanilla JS) ──HTTP──▶ control server (Node, no deps) :4310
                                          │
                                          ├─ registry    data/registry.json, data/meta/<id>/history.json
                                          ├─ agent       streams a model, executes tools, commits
                                          ├─ tools       read/write/edit/search/delete/run/image_generation
                                          ├─ devserver   one Vite child process per project :5180+
                                          └─ llm/        openai-compatible · anthropic · mock · image
                                          │
        preview iframe ◀──────────────────┘  (SSE events stream back to the UI the whole time)
```

The control server is the only long-lived process you start. It spawns Vite dev servers as children
and kills them on shutdown. Generated projects are ordinary folders under `data/projects/` — you can
open one in your editor, `cd` into it and run `npm run dev` yourself.

## Conventions used in these docs

- Paths are relative to the repository root unless absolute.
- `data/` means the runtime data directory (`LOVABLE_DATA_DIR`, default `<repo>/data`).
- "OpenAI-compatible" means any endpoint that speaks `POST {baseUrl}/chat/completions` with the
  OpenAI request/response schema — OpenAI itself, NVIDIA, Groq, OpenRouter, Together, Azure, vLLM.
- Secrets are never printed in these docs and are never written to disk when they came from the
  environment.
