import { streamAnthropic } from './anthropic.js'
import { streamOpenAi } from './openai.js'
import { streamMock } from './mock.js'
import { canonicalProvider } from '../config.js'

const ADAPTERS = {
  openai: streamOpenAi,
  anthropic: streamAnthropic,
  mock: streamMock,
}

export function resolveProvider(settings, override) {
  // Aliased names (e.g. `pollinations`) run on their canonical adapter.
  const requested = canonicalProvider(override || settings.provider || 'openai')
  if (!ADAPTERS[requested]) {
    throw new Error(`Unknown provider "${override || settings.provider}". Supported: ${Object.keys(ADAPTERS).join(', ')}`)
  }
  return requested
}

/** True when the chosen provider can actually be called. */
export function providerReady(settings, provider) {
  const canonical = canonicalProvider(provider || settings?.provider)
  if (canonical === 'mock') return true
  return Boolean(settings?.[canonical]?.apiKey)
}

/**
 * Verify credentials with the cheapest possible call. Used by the Settings
 * panel so a bad key or base URL is caught before an agent turn burns tokens.
 */
export async function testConnection(settings, provider) {
  const started = Date.now()
  try {
    const result = await streamChat({
      settings,
      provider,
      system: 'Reply with the single word: ok',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 16,
      signal: AbortSignal.timeout(30_000),
    })
    return {
      ok: true,
      provider,
      model: result.model,
      reply: result.text.trim().slice(0, 120),
      latencyMs: Date.now() - started,
    }
  } catch (err) {
    // The only abort source here is the 30 s deadline below, so an abort means
    // "the endpoint never answered", not "the user pressed Stop".
    const timedOut = err?.name === 'AbortError' || err?.name === 'TimeoutError'
    return {
      ok: false,
      provider,
      error: timedOut ? 'The endpoint did not respond within 30 seconds.' : err.message,
      status: err.status ?? null,
      hint: timedOut
        ? 'Check the base URL in Settings, and whether a proxy or firewall is blocking the request.'
        : (err.hint ?? null),
      latencyMs: Date.now() - started,
    }
  }
}

/** Single entry point used by the agent loop. */
export async function streamChat(options) {
  const provider = resolveProvider(options.settings, options.provider)
  return ADAPTERS[provider](options)
}

export { ADAPTERS }
