# Stillworks — launch plan

**Status:** planning document. No code changes are implied by this file.
**Scope:** sell the existing local, single-user desktop product. No SaaS, no multi-tenancy.
**Source facts:** every claim marked ✅ was read from this repo or verified against a live instance; claims marked ⚠️ need checking before they can be relied on.

---

## Progress

**Done in code (2026-09-24):** §1 rename to Stillworks executed across code, panel, metadata, docs and
installer config, including the `%APPDATA%` migration and the `STILLWORKS_DATA_DIR` alias — except the
migration itself, which is ⚠️ **untested until a packaged build exists** (`app.isPackaged` is false in
dev). §8 Pollinations preset wired as the default provider with a curated model list. From §5:
prerequisite detection ✅, registry version guard ✅, redacted diagnostics bundle ✅ — each with tests
(33 passing). §5.3 legal documents **drafted** in [`legal/`](legal/README.md) — EULA, terms, privacy,
refund — pending placeholder fill and a lawyer's review.

**Still open, in order:** trademark/domain clearance (§1), code-signing certificate and Apple Developer
account (§4 items 0.4), merchant of record (0.3), the Pollinations app key plus confirmation that its
dashboard can cap spend (0.6 and §8), auto-update (§5.1), `safeStorage` key migration (§5.2 — and note
the privacy policy currently states keys are unencrypted, which must be corrected the moment that
ships), docs rewrite for a buyer (§5.5), then Gate 2.

---

## 1. Name

**Recommended: Stillworks.**

Why this one:

- Says the positioning without saying "clone": *still* (no cloud, no telemetry, keeps working offline) + *works* (a workshop, like ironworks/gasworks — a place where things are made). Reads as an engineering shop, not a toy.
- Invented compound → strong trademark, no descriptive-meaning fight, easy to register.
- 10 letters, phonetic, survives being said out loud in a call.
- Collision check ⚠️ (shallow web search only): no software product surfaced under "Stillworks" or the alternate "Loamworks".

**Rejected, with reasons:**

| Candidate | Why not |
|---|---|
| Lovable Local | The current name. A live trademark risk and a README that calls itself a clone — cannot be invoiced. |
| Promptwright | Already used in this exact space (a prompt-engineering platform and a local-LLM dataset tool). |
| Quietworks | Already used: "task tracking software that runs on your own Wi-Fi" — same local-first pitch. |
| Workloft | Taken by coworking-space brands. |
| Homestead / Foundry Local / Anvil / Kiln / Vellum | Existing products in dev tooling or AI. |

**Alternates if Stillworks clears badly:** Loamworks (grow-your-own + workshop), Presshouse (finishing work in-house), Lockup (print shop + secure custody).

**Clearance steps before anything is printed (owner: you, ~1 hour):**

1. Trademark search: USPTO TESS, EUIPO eSearch, WIPO Global Brand Database — class 9 (software) and class 42 (dev tools).
2. Domain: `stillworks.app` / `.dev` / `.io`, plus the `.com` if it exists; check the GitHub org and npm scope are free.
3. A quick company-registry check in your jurisdiction if you'll form an entity under it.

### Rename inventory (measured in this repo, tracked files only)

~78 occurrences across 20 files. Most are text; four are load-bearing:

| Where | What it controls | Risk on change |
|---|---|---|
| `package.json` — `productName`, `productId`, `build.appId`, `build.productName`, `build.nsis.shortcutName`, `artifactName` | Installer name, Start Menu/desktop shortcut, exe metadata | Low, but changes the artifact filename |
| `%APPDATA%/Lovable Local/data` (derived from `productName` via Electron `app.getPath('userData')`) | **Where every customer's projects, registry and keys live** | **High — needs a migration, see §4** |
| `server/git.js` — commit author `Lovable Local Agent`, and `server/registry.js` — "Imported into Lovable Local" | Written into customers' git history permanently | Cosmetic, but old commits keep the old name forever |
| `tests/assets.test.js` — asserts the exact `<title>` string | CI | Test must be updated in the same commit |
| `web/index.html` (11), `web/site.webmanifest`, `web/app.js` (3), `server/config.js` (2), `electron/main.js` (4), `skills.json` (13), README + 8 docs files, `CHANGELOG.md` (4) | UI text, brand mark, JSON-LD `name`/`alternateName`, `og:site_name`, About panel | Straightforward find-and-replace |

Keep **CodeWoxy** as the publisher/company — it's the legal entity selling the thing, and the app name changing doesn't require it.

---

## 2. Positioning and buyer

**One sentence:** *Stillworks is the prompt-to-app studio that never leaves your machine — your prompts, your client's code and your API key stay local, and every project is an ordinary Vite repo with git history you own.*

**Against the hosted builders, the differences that are true today ✅:**

- No account, no server, no telemetry, no analytics anywhere in the codebase (verified: no telemetry/tracking calls).
- Bring-your-own-key; the platform's API keys never leave the machine, and env vars are never written to disk when supplied by the environment.
- Output is a real folder with its own git repo — export ZIP excludes `node_modules`/`.git`/build output and now excludes `.env` files.
- Works offline once dependencies are installed.
- Every agent turn auto-commits, with diffs, restore and revert in the panel.

**Who buys it:** developers and small agencies who will not paste client work into a hosted builder; people in regions where card billing on AI services is a hassle; anyone who wants the tool to still work when the vendor's pricing changes. Not: non-technical founders who want to deploy a landing page by Friday — that's exactly who Lovable serves better.

**Anti-positioning to hold:** do not compete on "the AI builds your app." Compete on "it happens on your computer."

---

## 3. Price and license

| SKU | Price | Includes |
|---|---|---|
| Founder (first 30 buyers) | **$29** one-time | Everything, 1 year of updates |
| Personal | **$59** one-time | 1 named user, up to 3 machines of theirs, 1 year of updates |
| Renewal (year 2+) | **$19/yr** | Updates + support. Not required to keep using the app. |
| Site (later, Gate 3) | **$199** | Same bits, for an internal team that wants one shared licence line |

**The licence has to be honest about enforcement.** `build.asar` is `false` ✅, so the app ships as readable plain files; any key check can be stripped in an afternoon. So the EULA grants a *personal* licence on trust, and the product's value is updates, support and the next model working — not copy prevention. Say "personal licence, 3 machines, no redistribution" and spend zero engineering on DRM.

**Lifetime updates are not on the table.** One year, then renewal. Otherwise you've promised free work forever against a cost base (model churn) you don't control.

---

## 4. Gate 0 — decisions (about one week, no code)

| # | Decision | Done when |
|---|---|---|
| 0.1 | Name cleared and chosen | Trademark/domain/org checks above complete; decision written here |
| 0.2 | Price + SKUs as above, or amended | Written into the plan; checkout can be created |
| 0.3 | Merchant of record chosen (Paddle / Lemon Squeezy / FastSpring) | Account open; they handle VAT + licence keys, so no per-country tax registrations |
| 0.4 | Code-signing identity chosen (OV vs EV Windows certificate; Apple Developer account) | Purchased; both take days-to-weeks of paperwork, start immediately |
| 0.5 | Data-dir migration strategy agreed | Written: copy-on-first-launch from `%APPDATA%/Lovable Local` to `%APPDATA%/Stillworks`, leave the original in place, log it, and tell the user the old path is now unused |
| 0.6 | Pollinations app key obtained and its wallet/app-key terms read first-hand | You've read the "connect user wallets" docs with the key in hand and can state what the 25% is credited against |

**Gate 0 exit:** name, price, checkout provider, certificates ordered, migration approach agreed. Nothing else starts until this is closed.

---

## 5. Gate 1 — the sellable build (2–3 weeks)

### 5.1 Install and trust

| Item | Why it matters | Acceptance criteria |
|---|---|---|
| Windows code signing | Unsigned EXE triggers SmartScreen ("Windows protected your PC"); buyers read that as malware | Installer and app both signed; SmartScreen absent on a clean download; `signtool verify` passes |
| macOS build + notarization | Gatekeeper blocks unsigned apps entirely | `dist:mac` produces a notarized `.dmg` that opens on a clean Mac ⚠️ (targets exist in `package.json` but have never been built) |
| Auto-update | None exists today ✅ (no `electron-updater`, no `checkForUpdates`). Without it, fixed bugs look unfixed | App detects, downloads, verifies signature and installs an update on relaunch; release notes from `CHANGELOG.md` shown |
| Prerequisite detection | Generated projects still need `npm` and `git` on PATH even in the desktop app ✅ | On launch, detect git + npm; missing → a screen naming the tool and a link, not a stack trace |
| First-run path | A cold start currently means reading the README | From install to a visible running app in ≤ 5 minutes with one key paste and one sample project |

### 5.2 Reliability

| Item | Status today | Acceptance criteria |
|---|---|---|
| Key storage | Plaintext in `data/settings.json` ✅ | Electron `safeStorage` (OS keychain) for keys; plaintext only as a documented fallback |
| Registry durability | `registry.json.bak` mirror + recovery on corrupt parse ✅ (added this session) | Also: a restore action in the UI, and the same mirror for `settings.json` |
| Data-dir versioning | `registry.json` carries `version: 1` ✅ but nothing reads it | A migration runner that refuses to start on an unknown-newer version and prints what to do |
| Model guidance | Any OpenAI-compatible endpoint accepted | Recommended list in Settings; detect weak models (empty responses, step-cap hits) and say "this model can't drive the agent loop" |
| Boring failures | Port range 5180–5380, `MAX_RUNNING_SERVERS` eviction ✅ | Human messages for "no free port", "server evicted", "dev server failed to start" |
| Ship unfinished work off | MCP connectors + skills factory are untested WIP ✅; two of four offered templates don't exist on disk ✅ (picker now filters by what's installed) | Both behind an "experimental" flag, off by default, labelled as such |
| Generated-project defaults | Templates set `allowedHosts: true` and `cors: true` ✅ | Either lock to localhost or document it on the security page — a customer sharing a preview URL shouldn't get an incident |

### 5.3 Legal documents to write

- **EULA** — personal licence, 3 machines, no redistribution, no warranty beyond stated support, termination on breach.
- **Terms of sale** — what's delivered, licence scope, dispute venue.
- **Privacy policy** — short and true: no account, no telemetry, nothing leaves the machine; the model provider you choose does see your prompts, and that's their policy, not ours.
- **Refund policy** — 14 days, no questions, since the bits are copyable and refunds will be rare.
- **Third-party licences** — the app has no runtime dependencies ✅ (Node built-ins only), but generated projects pull npm packages; state that the output's licence is the customer's business.

### 5.4 Support loop

No telemetry means you learn nothing passively, so build the escape hatch now:

- **Diagnostics bundle** (opt-in, one button): app version, OS, git/npm versions, `registry.json`, last N log lines, per-project `git status`, **with keys redacted**. One zip a customer can attach.
- **Known issues** page, **support address** with a stated response time (e.g. 2 business days), and the existing `CHANGELOG.md` published as a changelog page — `npm run version:check` already keeps it honest ✅, which most indie products can't say.
- **Reproduction path:** projects are git repos, so "send me the repo" reproduces most bugs. Document that in the support page.

### 5.5 Docs rewrite for a buyer

`docs/` is thorough but author-facing ✅. Add: a 5-minute quick start with screenshots, one end-to-end tutorial (build a small tracker app), a security page stating the local trust model honestly, and a migration note for anyone coming from the hosted builders.

---

## 6. Gate 2 — sell it (1 week, overlaps Gate 1)

1. **Landing page**: the one-sentence positioning, a 60-second GIF (type a prompt → app appears → edit lands in preview → commit in history), feature list phrased as differences, price, FAQ (why BYOK, why no cloud, what happens when I stop paying for updates).
2. **Presell 20–30 founder copies at $29** before the polish is finished, to people with a use this week: r/selfhosted, Hacker News Show HN, X/Bluesky dev audience, agency/Discord communities, Product Hunt on the day the signing + auto-update land.
3. **Deliverables per buyer**: licence key, download, quick start, support address. Nothing else.
4. **Instrument what you can without telemetry**: checkout conversion and refund rate are your only numbers. Accept that.

**Gate 2 exit criterion:** 20 paid licences and fewer than 3 refund requests. If that doesn't happen, the problem is positioning or price, not features — do not start Gate 3.

---

## 7. Gate 3 — only after Gate 2 pays

macOS/Linux polish → site licence SKU → finish or drop the MCP and skills-factory work → the missing Next.js/Svelte templates → and only then reconsider whether a hosted convenience tier is worth the abuse and metering work it drags in.

---

## 8. Pollinations as the preferred provider

### Status: wired, with one dependency that is now load-bearing

`server/config.js` now ships a **Pollinations preset first** in the picker
(`https://gen.pollinations.ai/v1`, default model `deepseek/deepseek-v4-flash`) and
`DEFAULT_SETTINGS.provider` is `pollinations`, so a fresh install starts there. A curated
`POLLINATIONS_MODEL_CHOICES` list backs the model field. Verified live against their API:

- `GET https://gen.pollinations.ai/v1/models` → **200, 255 text models**, ids are namespaced
  (`deepseek/deepseek-v4-flash`, `z-ai/glm-5.3`, `minimax/minimax-m3`, `moonshotai/kimi-k2.7-code`,
  `qwen/qwen3-coder-next`, `openai/gpt-5.4-mini`). Many `community/*` entries are noise, hence the
  curated list instead of the raw catalog.
- `POST /v1/chat/completions` **without a key → 401**: *"A valid API key is required. Get one at
  https://enter.pollinations.ai/keys"*.

**Consequence:** "install it and build something immediately" is **not** true with a Pollinations
default until a bundled key exists — a fresh install reads "Pollinations · no key" and the first
message fails. So **option C below moves from optional to a Gate 1 requirement**, or the default
provider flips back to one where the customer already holds a key.

### What is confirmed

- **App-key economics ✅:** Pollinations bills requests made under a developer's app key at **"+25% over model cost"**, and **credits the difference to your wallet as spendable Pollen**. It is a rebate in their currency, not cash — the same property you already noticed.
- **Account integration surface ✅ (from the OpenAPI spec):** `/account/integrations` with `GET`/`POST`/`DELETE /account/integrations/{id}`, `toolkit` required on `POST`; API keys need the `account:keys` scope; models can be restricted to **Paid Pollen** spend.
- **Wallet module ⚠️:** the docs' "Connect User Wallets" section (paid / Quest coins) is a JS-rendered Swagger view; the spec text I could retrieve only links to it. **Unverified until you hand me the app key** and we call it live.

### The decision that actually matters: whose key ships

| Model | How it works | Profit | Risk |
|---|---|---|---|
| **A. Pure BYOK** | Each customer pastes their own Pollinations key | None | None — this is the default and it's the honest pitch |
| **B. Bundled app key** | You ship your app key so a new install works instantly; their usage bills at +25% and the difference lands in your wallet | ~25% of customer inference, in Pollen | **The key is extractable from a `asar: false` binary.** One abusive user can drain your wallet, and you pay for everyone's experiments |
| **C. Hybrid (recommended)** | Ship B, capped hard, and prompt to A on first run | Same rebate, bounded | Cap does the work |

**If you choose C, the cap is the product decision, not an implementation detail:**

- A per-install spend ceiling (daily and monthly), enforced **client-side and server-side** — client-side alone is decoration since the key is public.
- Pollinations' own per-key limits configured on the key before it ships ⚠️ (confirm the dashboard exposes spend caps; if it doesn't, C is not safe to ship).
- A visible "you're on the bundled key — connect your own" state in the panel, so a customer hitting the ceiling knows what to do instead of seeing an error.
- A rotation plan: a build can't be recalled, so assume the bundled key leaks the day you ship and treat it as a marketing budget with a hard monthly number.

**Decided (2026-09-24): option C — BYOK plus a capped trial key.** The reasoning stands: the 25%
comes back as Pollen, not cash — on the earlier math (~$0.60–4.40 of inference per customer per
month) that is 15¢–$1.10 — so the bundled key is bought for **conversion, not revenue**: "install it
and make something in five minutes" is worth more than the rebate. The keyless-401 finding above makes
it mandatory rather than nice, because a Pollinations default with no key is a dead first run.

**Blocking condition:** confirm the Pollinations dashboard can put a **server-side spend limit on the
app key**. If it cannot, C is unsafe to ship in a `asar: false` binary and the default provider must
revert to BYOK-only with the picker opened on the customer's own key.

### Default model list for the Settings picker

Priced per 1M tokens (input/output), with your own observed turn cost (≈79k in / 2.5k out, from `158,022 / 4,939` over 2 turns in this project's usage counters):

| Model | $/1M in / out | ≈ per heavy turn | Role in the picker |
|---|---|---|---|
| DeepSeek V4 Flash | 0.14 / 0.28 | ~$0.012 | Default "cheap, big context (1M)" |
| MiniMax M3 | 0.30 / 1.20 | ~$0.026 | "Best agentic value" |
| GLM-5 | 1.00 / 3.20 | ~$0.087 | "Strong at coding" |
| Kimi K2.6 | 0.95 / 4.00 | ~$0.085 | "Frontier-ish, pricier" |
| Gemini 3.1 Flash-Lite | 0.25 / 1.50 | ~$0.023 | "Fast drafts / plan mode" |

### Caveats to state in the product, not bury

- Pollinations is a reseller/router; prompts reach upstream providers, some **China-hosted**, so data residency and compliance are the customer's call — say it plainly in the provider row.
- Independent reviews note **tool-call serialisation** is what breaks first on cheap models, and that these models churn fast — an upgrade can break the agent loop, so pin model names in your defaults and test each release.
- Credits are Pollen, not withdrawable; don't build a P&L on it.
- One-vendor dependency: keep every OpenAI-compatible endpoint working (they do today ✅), and never make Pollinations the only path.

---

## 9. Risks, stated plainly

| Risk | Honest read |
|---|---|
| Piracy | Trivial with `asar: false`. Price accordingly; sell updates and support. |
| One-time revenue | Cash spikes then flatlines unless renewal lands. Watch renewal rate as the real health signal. |
| No usage data | You will not know what breaks. The diagnostics bundle is the substitute. |
| Model churn | Your product quality is a function of third-party models. Pin, test, and keep BYOK so the customer can switch without waiting for you. |
| Bundled key abuse | If §8 option C ships without a server-side cap, one person can burn a month of revenue. |
| Name/trademark | The rename is a precondition of charging, not a cosmetic task. |
| Signing lead times | Certificates and Apple notarization take days-to-weeks; order them in Gate 0 or Gate 1 slips. |

---

## 10. Timeline

| Phase | Duration | Gate to proceed |
|---|---|---|
| Gate 0 — decisions | 1 week | Name cleared, price set, MoR + certs ordered |
| Gate 1 — sellable build | 2–3 weeks | Signed build + auto-update + first run + legal docs all pass a clean-machine install test |
| Gate 2 — go to market | 1 week (overlaps) | 20 paid licences, <3 refunds |
| Gate 3 — after revenue | ongoing | Only with paying customers asking |

**Total to first revenue: roughly 4 weeks.** The multi-tenant work that used to dominate this plan is gone; what's left is packaging, paperwork and distribution.

---

## 11. What I need from you

1. Approval on **Stillworks** (or an alternate) so the rename inventory can be executed in one pass.
2. The **Pollinations app key**, so I can verify the wallet/app-key flow live instead of from a spec I couldn't fully read — and a decision on §8 option A vs C, with a monthly ceiling if C.
3. Confirmation you've started **code signing** and the **merchant of record** signups (longest lead times).
4. A yes/no on whether the **`%APPDATA%` migration** should copy-and-keep or copy-and-delete.

Then say go and I'll work through Gate 0 → 1 in order, starting with the rename and the data-dir migration.
