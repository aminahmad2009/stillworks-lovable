import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Repository root of this tool (the folder holding server/ and web/). */
export const ROOT_DIR = path.resolve(__dirname, '..')

/* ------------------------------- identity ------------------------------- */
/* One source of truth for "what build is this". package.json holds the
 * version; everything else (health endpoint, About dialog, installer) reads
 * these constants so they can never drift apart. */

const pkg = JSON.parse(readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'))

/** Semver of the running build, e.g. "0.2.0". */
export const APP_VERSION = pkg.version

/** Stable product identifier — the same string across builds, machines and
 *  installs. Used as the desktop appId stem and shown in About / health. */
export const PRODUCT_ID = pkg.productId || 'codewoxy-stillworks'

export const PRODUCT_NAME = pkg.build?.productName || 'Stillworks'
export const COMPANY = pkg.company || 'CodeWoxy'
export const REPOSITORY = String(pkg.repository?.url || pkg.repository || '').replace(/^git\+/, '').replace(/\.git$/, '')

// STILLWORKS_DATA_DIR is the current name. LOVABLE_DATA_DIR keeps working so
// existing scripts, shortcuts and the packaged app's first launch are unaffected.
const dataOverride = process.env.STILLWORKS_DATA_DIR || process.env.LOVABLE_DATA_DIR

export const WEB_DIR = path.join(ROOT_DIR, 'web')
export const DATA_DIR = dataOverride
  ? path.resolve(dataOverride)
  : path.join(ROOT_DIR, 'data')

export const PROJECTS_DIR = path.join(DATA_DIR, 'projects')
export const META_DIR = path.join(DATA_DIR, 'meta')
/** Removed project folders land here instead of being deleted outright. */
export const TRASH_DIR = path.join(DATA_DIR, '.trash')
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
export const REGISTRY_FILE = path.join(DATA_DIR, 'registry.json')

export const CONTROL_PORT = Number(process.env.PORT) || 4310
export const CONTROL_HOST = process.env.HOST || '127.0.0.1'

/** First port handed to a generated project's dev server. */
export const PROJECT_PORT_START = Number(process.env.PROJECT_PORT_START) || 5180
export const PROJECT_PORT_END = Number(process.env.PROJECT_PORT_END) || 5380

/** Hard ceiling on how many dev servers may run at once. */
export const MAX_RUNNING_SERVERS = Number(process.env.MAX_RUNNING_SERVERS) || 4

/**
 * Provider names that run on another provider's adapter and settings block.
 * `pollinations` is the default provider (see LAUNCH-PLAN.md §8) and speaks the
 * OpenAI-compatible protocol — its key and endpoint live in `settings.openai`,
 * which the Settings UI's preset picker fills with the Pollinations base URL.
 */
export const PROVIDER_ALIASES = { pollinations: 'openai' }

/** Canonical provider name: the adapter/settings block that serves it. */
export function canonicalProvider(provider) {
  return PROVIDER_ALIASES[provider] || provider
}

export const DEFAULT_SETTINGS = {
  provider: 'pollinations',
  anthropic: {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
  },
  openai: {
    apiKey: '',
    baseUrl: 'https://gen.pollinations.ai/v1',
    model: 'deepseek/deepseek-v4-flash',
  },
  /**
   * Optional OpenAI-compatible image endpoint (`POST {baseUrl}/images/generations`).
   * A blank baseUrl/apiKey means "reuse the OpenAI-compatible text endpoint",
   * so a gateway that serves both only needs the model name here.
   */
  image: {
    apiKey: '',
    baseUrl: '',
    model: '',
    size: '1024x1024',
  },
  agent: {
    maxSteps: 24,
    autoInstall: true,
    autoCommit: true,
    reviewCommit: false,
  },
}

/** Names a generated project is allowed to see. Everything else stays here. */
const CHILD_ENV_NAMES = new Set([
  // launching processes
  'path', 'pathext', 'comspec', 'systemroot', 'windir', 'tmp', 'temp', 'tmpdir',
  // home and identity, needed by npm, git and node
  'home', 'userprofile', 'homedrive', 'homepath', 'userdomain', 'username',
  'appdata', 'localappdata', 'programdata', 'programfiles', 'programfiles(x86)', 'programw6432',
  // locale and terminal behaviour
  'lang', 'lc_all', 'lc_ctype', 'tz', 'term', 'shell', 'user', 'display',
  // lets the packaged app run real node scripts
  'electron_run_as_node',
])

/** Proxy and trust-store settings: useless if stripped, and not secret-bearing. */
const CHILD_ENV_EXTRA = new Set([
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy', 'ftp_proxy',
  'ssl_cert_file', 'ssl_cert_dir', 'node_extra_ca_certs',
])

const CHILD_ENV_PREFIXES = ['npm_config_', 'corepack_', 'yarn_', 'pnpm_']

/**
 * Environment for anything a generated project runs — npm, `node` on a project
 * script, the dev server, an MCP connector. Deny-by-default on purpose: the
 * platform's own API keys, and every credential in the shell that started it,
 * would otherwise be readable by code the model wrote or by a dependency's
 * postinstall script. `NODE_OPTIONS` is excluded for the same reason — it can
 * inject code into every child.
 *
 * `overrides` (the project's PORT, a connector's own env) is merged last, so
 * secrets are supplied per project rather than inherited. Anything genuinely
 * needed can be opted in: `LOVABLE_CHILD_ENV=FOO,BAR`.
 */
export function childEnv(overrides = {}) {
  const optedIn = String(process.env.LOVABLE_CHILD_ENV || '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)

  const safe = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    if (
      CHILD_ENV_NAMES.has(lower)
      || CHILD_ENV_EXTRA.has(lower)
      || optedIn.includes(lower)
      || CHILD_ENV_PREFIXES.some((prefix) => lower.startsWith(prefix))
    ) {
      safe[key] = value
    }
  }
  return { ...safe, FORCE_COLOR: '0', ...overrides }
}

export async function ensureDataDirs() {
  for (const dir of [DATA_DIR, PROJECTS_DIR, META_DIR, TRASH_DIR]) {
    await mkdir(dir, { recursive: true })
  }
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(base?.[key], value)
    } else if (value !== undefined) {
      out[key] = value
    }
  }
  return out
}

async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  const { rename } = await import('node:fs/promises')
  await rename(tmp, file)
}

/**
 * Load settings, layering: defaults <- settings.json <- environment.
 * Environment wins so a user can run without ever opening the settings UI.
 *
 * Note on ANTHROPIC_AUTH_TOKEN: that is a *gateway* credential and is only
 * usable together with a matching ANTHROPIC_BASE_URL. Adopting it while
 * pointed at api.anthropic.com produces a confusing 401, so it is ignored
 * unless a base URL is supplied alongside it.
 */
export async function loadSettings() {
  await ensureDataDirs()
  const stored = await readJson(SETTINGS_FILE, {})
  const merged = deepMerge(DEFAULT_SETTINGS, stored)

  const envBaseUrl = process.env.ANTHROPIC_BASE_URL
  if (envBaseUrl && !stored.anthropic?.baseUrl) merged.anthropic.baseUrl = envBaseUrl

  if (process.env.ANTHROPIC_API_KEY && !merged.anthropic.apiKey) {
    merged.anthropic.apiKey = process.env.ANTHROPIC_API_KEY
  } else if (process.env.ANTHROPIC_AUTH_TOKEN && envBaseUrl && !merged.anthropic.apiKey) {
    merged.anthropic.apiKey = process.env.ANTHROPIC_AUTH_TOKEN
  }
  if (process.env.ANTHROPIC_MODEL) merged.anthropic.model = process.env.ANTHROPIC_MODEL

  const envOpenAiKey = process.env.OPENAI_API_KEY
  if (envOpenAiKey && !merged.openai.apiKey) merged.openai.apiKey = envOpenAiKey
  if (process.env.OPENAI_BASE_URL && !stored.openai?.baseUrl) {
    merged.openai.baseUrl = process.env.OPENAI_BASE_URL
  }
  if (process.env.OPENAI_MODEL) merged.openai.model = process.env.OPENAI_MODEL

  // Image generation is optional; it inherits the OpenAI-compatible endpoint
  // unless overridden, so IMAGE_MODEL alone is enough for most gateways.
  if (process.env.IMAGE_API_KEY && !merged.image.apiKey) merged.image.apiKey = process.env.IMAGE_API_KEY
  if (process.env.IMAGE_BASE_URL && !stored.image?.baseUrl) merged.image.baseUrl = process.env.IMAGE_BASE_URL
  if (process.env.IMAGE_MODEL) merged.image.model = process.env.IMAGE_MODEL
  if (process.env.IMAGE_SIZE) merged.image.size = process.env.IMAGE_SIZE

  return merged
}

/** Persist only the user-editable subset; never write env-derived secrets to disk. */
export async function saveSettings(patch) {
  const current = await readJson(SETTINGS_FILE, {})
  const next = deepMerge(current, patch)
  await writeJsonAtomic(SETTINGS_FILE, next)
  return loadSettings()
}

/** True when a secret came from the environment rather than settings.json. */
export function keySource(settings, provider) {
  const canonical = canonicalProvider(provider)
  const envKeys = canonical === 'anthropic'
    ? [process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_AUTH_TOKEN]
    : canonical === 'image'
      ? [process.env.IMAGE_API_KEY]
      : [process.env.OPENAI_API_KEY]
  const configured = settings?.[canonical]?.apiKey
  if (!configured) return 'none'
  return envKeys.some((key) => key && key === configured) ? 'environment' : 'settings'
}

/** Presets offered in the Settings UI for OpenAI-compatible endpoints. */
export const OPENAI_COMPATIBLE_PRESETS = [
  // Preferred: one OpenAI-compatible endpoint over 250+ models, and the only one
  // with a developer app-key scheme (see LAUNCH-PLAN.md §8). Model ids are
  // namespaced — `deepseek/deepseek-v4-flash`, not `deepseek`.
  { id: 'pollinations', label: 'Pollinations.ai', baseUrl: 'https://gen.pollinations.ai/v1', model: 'deepseek/deepseek-v4-flash' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.5' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { id: 'azure', label: 'Azure OpenAI', baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT', model: 'gpt-4o' },
  { id: 'custom', label: 'Custom endpoint', baseUrl: '', model: '' },
]

/**
 * Models worth naming in the UI for the Pollinations preset, cheapest first.
 * Verified against `GET https://gen.pollinations.ai/v1/models`.
 */
export const POLLINATIONS_MODEL_CHOICES = [
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash · cheapest capable, 1M context' },
  { id: 'minimax/minimax-m3', label: 'MiniMax M3 · strong agentic value' },
  { id: 'z-ai/glm-5.3', label: 'GLM 5.3 · well regarded for coding' },
  { id: 'moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code · code-tuned, pricier' },
  { id: 'qwen/qwen3-coder-next', label: 'Qwen3 Coder Next · large code context' },
  { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini · fast drafts and plan mode' },
]

/** Sizes offered in the Settings UI for the image model. */
export const IMAGE_SIZE_PRESETS = [
  { id: '1024x1024', label: 'Square · 1024×1024' },
  { id: '1536x1024', label: 'Landscape · 1536×1024' },
  { id: '1024x1536', label: 'Portrait · 1024×1536' },
  { id: '1792x1024', label: 'Wide · 1792×1024' },
  { id: '512x512', label: 'Small · 512×512' },
  { id: '256x256', label: 'Tiny · 256×256 (cheap test)' },
]

export { readJson, writeJsonAtomic, existsSync }