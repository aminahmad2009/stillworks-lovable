# Legal documents — status and pre-publication checklist

**These are drafts, not legal advice.** They were written from the actual behaviour of this codebase,
which makes them accurate but not sufficient. Have a lawyer qualified in your jurisdiction review them
before you take money, and re-review whenever the app starts contacting a new endpoint or storing data
differently.

| File | Covers | Ships in the app? |
|---|---|---|
| [`EULA.md`](EULA.md) | What the buyer may and may not do with the software | Yes — show at first launch, link from About |
| [`TERMS.md`](TERMS.md) | The sale: what is delivered, price, renewal, disclaimers, liability | Yes — link from checkout and the site |
| [`PRIVACY.md`](PRIVACY.md) | Data handling, every network connection the app makes, storage locations | Yes — link from Settings and the site |
| [`REFUND.md`](REFUND.md) | Refund policy | No — checkout page only |

## Placeholders to replace before publishing

Search this folder for `[` and fill in every one:

| Placeholder | Where it appears | What to put |
|---|---|---|
| `[LEGAL ENTITY]` | all | Your registered company name, or your full name if selling as an individual |
| `[SUPPORT EMAIL]` | all | The address you will actually answer |
| `[COUNTRY / STATE]` | EULA, TERMS | Governing-law jurisdiction |
| `[COMPANY ADDRESS]` | TERMS | Required on invoices in most jurisdictions |
| `[MERCHANT OF RECORD]` | TERMS, REFUND | Paddle / Lemon Squeezy / FastSpring — whoever is the seller of record |
| `[WEBSITE]` | TERMS, PRIVACY | Public site URL |
| `[EFFECTIVE DATE]` | all | Date you publish them |

## Facts these drafts depend on

Written against the current build, so re-check them when any of it changes:

- No account, no sign-in, no phone-home, **no telemetry, analytics or crash reporting** of any kind.
- The app makes outbound network calls only to: the **model endpoint you configure**; the npm registry
  when installing project dependencies; `registry.modelcontextprotocol.io` when you open the connector
  catalogue; and `raw.githubusercontent.com` when you search the skill catalogue.
- **API keys are stored unencrypted in `data/settings.json`** in this build. Once `safeStorage` lands,
  update §4 of the privacy policy — do not claim encryption before it ships.
- The control server listens on `127.0.0.1` and has **no authentication**.
- The desktop build is packaged with `asar: false`, so application files are readable on disk. Do not
  write anything that promises the software cannot be inspected.
- Pollinations and other gateways route prompts to upstream providers, **which may process data in
  other jurisdictions**.
