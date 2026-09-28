# Privacy policy — Stillworks

**Version:** draft 1 · **Effective:** [EFFECTIVE DATE] · **Contact:** [SUPPORT EMAIL]

Plain-language summary first.

> **In short:** Stillworks is a local program. It has no account, no server of ours, and no analytics,
> telemetry or crash reporting. Your prompts, your files and your projects stay on your computer. The
> only things that leave your machine are the requests you choose to send to the AI provider you
> configure, and package downloads from npm when your projects install dependencies. We never see any of
> it. We do learn your name and email when you buy a licence, and that is handled by our payment
> provider.

## 1. Who we are

[LEGAL ENTITY] ("we", "us"), [COMPANY ADDRESS], sells and maintains Stillworks. Questions about this
policy go to **[SUPPORT EMAIL]**.

## 2. The core design point: we have no access to your work

The Software runs entirely on your machine and talks to no server operated by us. There is no sign-in, no
usage reporting, no analytics SDK, no error or crash submission, and no background check for anything
except the optional update feed described in §6. We cannot read your projects, your prompts or your
generated code, and we do not collect them.

## 3. What does leave your computer

Everything below happens because **you** configured it or opened it. Each row names the destination and
what is sent.

| Destination | When | What is sent |
|---|---|---|
| **Your model provider's endpoint** (OpenAI, Anthropic, OpenRouter, Groq, Together AI, Pollinations, or any URL you enter) | Every agent turn, plan message, and image request | Your message, the project's file tree, and the contents of files the agent reads or writes. **This is your work going to a third party under their terms and their data-retention policy.** Choose a provider you are allowed to use for the work in front of you |
| **npm registry** (and any registry mirror you configure) | When a project installs dependencies | Only package names and versions. Triggered by the agent running `npm install`, or by you starting a project |
| **`registry.modelcontextprotocol.io`** | Only when you open the connector catalogue and search it | Your search text. No account data |
| **`raw.githubusercontent.com`** (the Stillworks skills catalogue) | Only when you open the skill search field | Your search text. Results are cached for five minutes |
| **`gen.pollinations.ai`** | Only if you select Pollinations as your provider | Same as any model provider above — see §5 about routing |

Nothing else in the application makes an outbound connection.

## 4. What is stored on your machine, and how to clear it

All state is files in the app's data directory:

- Windows `%APPDATA%\Stillworks\data` (installed app) · macOS `~/Library/Application Support/Stillworks/data` · Linux `~/.config/Stillworks/data` · running from source: `./data`

| File | Contents | Sensitivity |
|---|---|---|
| `settings.json` | Provider base URLs, model names, agent options, and **your API keys** | **High — read §4.1** |
| `registry.json` (+ `.bak`) | Project names, folder paths, ports, token/turn counters | Medium: reveals what you are working on |
| `meta/<project-id>/history.json` | Chat transcripts, last 400 messages | High: your prompts |
| `projects/<slug>/` | The generated applications, each a git repository | High: your source code and its history |
| `.trash/` | Project folders you asked to remove; emptied only by you | High |
| `skills.json`, `mcp.json` | Your custom skills and connector definitions | Low, unless a connector config holds a token |

### 4.1 API keys — read this

In the current version, keys you paste into Settings are stored **unencrypted** in `settings.json`, and
keys supplied as environment variables are read from the environment and never written to disk. Anyone
with access to your user account or a backup of it can read that file. Encrypting this with the operating
system keychain is planned; until it ships, treat `settings.json` as a secret, use a key you can revoke,
and prefer environment variables if you are comfortable with them.

### 4.2 Deleting everything

Quit the app and delete the data directory above. That removes projects, history, settings and keys in one
step. Nothing needs to be deleted on our side, because nothing is stored on our side.

## 5. Model providers, routing and where your data lands

You choose the provider, and their privacy policy governs what they do with what you send. This matters
more than it looks: an agent turn can include the contents of several source files. Two specific points:

- **Gateways and routers** (Pollinations, OpenRouter and similar) forward your prompts to upstream
  providers, which may operate in, and process data under, **other jurisdictions**. If your client work
  has residency or confidentiality constraints, check the router's upstream list before using it.
- **Local models.** If you point the app at a server on your own network, nothing leaves that network.

## 6. Updates

If and when automatic updating is enabled, the app checks a download endpoint for a signed release
manifest. That request carries your app version and operating system to the hosting provider's logs — the
same kind of request any browser makes. Update checks are opt-in or off by default where the platform
allows it, and no personal data is included deliberately.

## 7. Purchase data

When you buy a licence, our seller of record **[MERCHANT OF RECORD]** collects your name, email address,
country and billing details as required for payment and tax, and passes us your email, licence status and
region. We use it to deliver the software, provide support and send update notices. We do not receive your
payment instrument details. Retention follows the payment provider's terms and applicable tax law.

## 8. Support and diagnostics

If you email us, you choose what to share. The in-app **Download diagnostics** action produces one JSON
file containing app and OS versions, paths, project records, server log tails and masked settings — it
does **not** contain API keys. It is only created when you click it, and only leaves your machine if you
attach it to a message. We delete diagnostic files and emails when a support thread closes, unless we must
retain them.

## 9. The local network port

The control panel is served on `127.0.0.1` (loopback) and has **no authentication**. It is not reachable
from other machines as configured, but any process or user account on your own computer can drive it. Do
not change the host binding to expose it on a network; doing so turns a local tool into an open control
plane for your projects.

## 10. Children, changes, and your rights

The Software is a developer tool and is not directed at children under 16. If we make a material change to
this policy we will update the date above and describe it in the app and at [WEBSITE]. Because we hold
almost nothing about you, a request to erase your data usually means "delete the files on my own machine"
— and for purchase records, contact [MERCHANT OF RECORD] or us at **[SUPPORT EMAIL]**; we honour access,
correction and deletion requests under GDPR, UK GDPR and comparable laws, and we will tell you which
records we cannot delete and why.

## 11. A limitation worth stating plainly

This policy describes what the Software does, not what a person could make it do. The agent can run
commands and install packages inside your projects, and generated code is yours to review. Nothing here
should be read as a security guarantee: the desktop build is distributed as unpacked files, and a
determined dependency is a determined dependency. Keep your keys revocable and review what you install.
