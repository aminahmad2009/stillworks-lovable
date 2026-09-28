import path from 'node:path'
import { TOOL_DEFINITIONS, executeTool } from './tools.js'
import { aggregatedTools, executeMcpTool } from './mcp/manager.js'
import { streamChat } from './llm/index.js'
import { TRANSIENT_CODES } from './llm/sse.js'
import { imageCapability } from './llm/image.js'
import { manager, emit } from './devserver.js'
import { loadHistory, appendHistory, touchProject, addProjectUsage } from './registry.js'
import { gitCommitAll, gitStatusShort } from './git.js'
import { listProjectTree } from './files.js'
import { designBrief } from './designs.js'
import { skillsBrief } from './skills.js'
import { canonicalProvider } from './config.js'

const HISTORY_TURNS = 24

/** Providers throttle; a one-shot turn that dies on a 429 wastes the work. */
const RETRYABLE = /overloaded|rate limit|too many requests|temporarily unavailable|service unavailable|connection (?:reset|error)|ECONNRESET/i
const RETRY_DELAYS = [6000, 15000]

/** How many times an empty model response is retried before we report it. */
const EMPTY_RESPONSE_RETRIES = 2
const EMPTY_RESPONSE_DELAY = 900

async function streamWithRetry(options, projectId) {
  let attempt = 0
  for (;;) {
    try {
      return await streamChat(options)
    } catch (err) {
      // Transport failures arrive already translated, so match on the code as
      // well as the wording — "the connection dropped mid-request" is retryable
      // even though it no longer contains the string "ECONNRESET".
      const retryable = err.status === 429
        || (err.status >= 500 && err.status < 600)
        || TRANSIENT_CODES.has(err.code || '')
        || RETRYABLE.test(err.message || '')
      if (!retryable || attempt >= RETRY_DELAYS.length || options.signal?.aborted) throw err
      const delay = RETRY_DELAYS[attempt]
      attempt++
      emit(projectId, 'agent:retry', { attempt, delayMs: delay, message: err.message })
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

/** History writes must never mask the real error, and must never throw. */
async function safeAppendHistory(projectId, persisted) {
  try {
    await appendHistory(projectId, persisted)
    return null
  } catch (err) {
    return err
  }
}

function frameworkNotes(template) {
  if (template === 'vue-vite') {
    return {
      stack: 'Vue 3 (SFCs), TypeScript, Vite 8, Tailwind CSS 4.',
      conventions: `- \`index.html\` loads \`/src/main.ts\`. Do not change that script tag.
- \`src/main.ts\` mounts \`App.vue\` from \`src/App.vue\` onto \`#app\`. Keep that entry point stable.
- Components are single-file components in \`src/components/\` (\`.vue\`), routes in \`src/pages/\`, shared helpers in \`src/lib/\`, composables in \`src/composables/\`.
- Use \`<script setup lang="ts">\` in SFCs. Style with Tailwind utility classes in the template.`,
    }
  }
  if (template === 'svelte-vite') {
    return {
      stack: 'Svelte 5, TypeScript, Vite 8, Tailwind CSS 4.',
      conventions: `- \`index.html\` loads \`/src/main.ts\`. Do not change that script tag.
- \`src/main.ts\` mounts \`App.svelte\` from \`src/App.svelte\` onto \`#app\`. Keep that entry point stable.
- Components go in \`src/components/\` (\`.svelte\` files), routes in \`src/pages/\`, shared helpers in \`src/lib/\`, stores in \`src/stores/\`.
- Use Svelte 5 runes (\`$state\`, \`$derived\`, \`$effect\`) for reactivity. Style with Tailwind utility classes in the markup.
- Prefer component-level state with \`let count = $state(0)\` over global stores unless sharing state across components.`,
    }
  }
  if (template === 'nextjs') {
    return {
      stack: 'Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4.',
      conventions: `- Pages live in \`app/\` as directories with \`page.tsx\`, \`layout.tsx\`, etc.
- Use Server Components by default; add \`'use client'\` only when you need interactivity (hooks, event handlers).
- API routes go in \`app/api/\` as route handlers (\`route.ts\`).
- Style with Tailwind utility classes directly in JSX. No tailwind.config.js needed.
- Data fetching uses async Server Components or React Query for client-side data.`,
    }
  }
  return {
    stack: 'React 19, TypeScript, Vite 8, Tailwind CSS 4.',
    conventions: `- \`index.html\` loads \`/src/main.tsx\`. Do not change that script tag.
- \`src/main.tsx\` renders \`<App />\` from \`src/App.tsx\`. Keep that entry point stable.
- Components go in \`src/components/\`, routes in \`src/pages/\`, shared helpers in \`src/lib/\`, hooks in \`src/hooks/\`.`,
  }
}

/**
 * Tell the model what image capability exists right now. The wording matters:
 * with a model configured it should reach for `image_generation` instead of
 * drawing SVG placeholders; without one it must still try, and then report the
 * failure plainly rather than stopping silently.
 */
function imageBrief(settings, provider) {
  const cap = imageCapability(settings, provider)
  if (cap.available) {
    const fallback = cap.fallbacks.length
      ? ` If that endpoint fails, the platform automatically retries with ${cap.fallbacks.join(', ')}.`
      : ''
    return `
## Image generation
An OpenAI-compatible image model is configured: \`${cap.model}\` on ${cap.host}.${fallback}
When the app needs real imagery — hero art, illustrations, product shots, textures, avatars,
empty-state art — call \`image_generation\` with a detailed visual prompt instead of hand-drawing
SVG placeholders or leaving empty gradient boxes. Generated files are saved under
\`public/generated/\` and referenced from code as \`/generated/<file>\`.
If the call fails, the tool returns the exact error: report it to the user, then continue with a
non-image implementation so the app still works. Never end the turn without saying what happened.
`
  }
  return `
## Image generation
No dedicated image model is configured, so \`image_generation\` falls back to the active
OpenAI-compatible text endpoint — which usually has no image route and will fail. Prefer CSS,
inline SVG or typed placeholders for imagery. If the user explicitly asks for generated images,
call \`image_generation\` once; when it fails, quote the error and tell them to add a model in
Settings → Image model. Never stop without saying what went wrong.
`
}

function systemPrompt(project, tree, mode, skillsText = '', imageText = '', personas = {}) {
  const fw = frameworkNotes(project.template)
  
  // Inject custom personas if provided
  const systemPersona = personas.system || ''
  const assistantPersona = personas.assistant || ''
  const personaSection = systemPersona ? `\n## System Persona\n${systemPersona}` : ''
  const assistantSection = assistantPersona ? `\n## Assistant Style\n${assistantPersona}` : ''
  
  const stack = `
## Project
- Name: ${project.name}
- Root directory: ${project.path}
- Stack: ${fw.stack}${personaSection}${assistantSection}

## How Tailwind 4 works here
- Tailwind is wired through the \`@tailwindcss/vite\` plugin. There is NO tailwind.config.js and you must not create one.
- \`src/index.css\` contains \`@import "tailwindcss";\`. Design tokens live in an \`@theme\` block there.
- Style with utility classes in JSX. Only add plain CSS to src/index.css for global rules or keyframes.

## Project conventions
${fw.conventions}
- The \`@/\` path alias maps to \`src/\`. Use it for imports.
- Prefer small focused files over one large component.

## Rules
- Write complete, working files. Never leave TODO comments, placeholders, or "rest of code here" stubs.
- For changes to an existing file prefer \`edit_file\` with exact text over rewriting the whole file.
- Read a file before editing it. Do not guess at existing content or indentation.
- Add dependencies with \`run_command\` using \`npm install <packages>\`. They are installed into the project automatically.
- \`write_file\` creates every missing parent directory, so never run \`mkdir\` — the shell is allowlisted to package, typecheck and read-mostly git commands and directory tools are not part of it.
- Do NOT run \`npm run dev\`, \`vite\`, or any long-lived server. The platform already runs the dev server and streams its output; starting another one will conflict on the port.
- Do NOT run \`git commit\`. The platform commits automatically after each turn.
- You may run \`npx tsc --noEmit\` to typecheck when a change is intricate.
- The app is rendered inside an iframe in a preview panel, so avoid anything that requires top-level navigation.
- Always end your turn with a short text reply. If something failed, say what failed and why — an empty reply is treated as an error.
- The user can send messages while you are working. A user message that arrives mid-turn is steering: it refines or overrides the plan you are executing. Adjust immediately, keep whatever work is still correct, and acknowledge the change in one clause — do not restart from scratch unless asked, and do not ignore it.
${designBrief(project.designId)}${skillsText}${imageText}
## Current file tree
${tree}
`

  if (mode === 'plan') {
    return `${stack}
## Mode: PLAN
You are planning only. You have no tools in this mode and must not claim to have changed files.
Discuss approach, structure, data model and trade-offs. Be concrete and brief. When the user is
happy they will switch to Agent mode to have the work done.`
  }

  return `${stack}
## Mode: AGENT
You have tools to read and write this project directly. Use them to complete the request end to end.

Working method:
1. Look at the file tree above. Read the files you intend to change before changing them.
2. Make the edits. Build features completely rather than sketching them.
3. When you add dependencies, install them before importing them.
4. Finish with one or two sentences on what changed and what to look at in the preview. Do not
   recap every file and do not narrate the diff.

If a tool returns an error, or the platform reports a build error, fix it and keep going rather
than stopping to ask. Only ask the user a question when the request is genuinely ambiguous in a way
that would change what you build.`
}

function trimHistory(messages) {
  if (messages.length <= HISTORY_TURNS * 2) return messages
  const kept = messages.slice(-HISTORY_TURNS * 2)
  // Never start on a tool_result: it would reference a tool_use we dropped.
  while (kept.length && kept[0].role === 'user'
    && Array.isArray(kept[0].content)
    && kept[0].content.some((b) => b.type === 'tool_result')) {
    kept.shift()
  }
  return kept
}

/** Turn a blank model response into something a human can act on. */
function emptyResponseError(result, providerName) {
  const stop = result?.stopReason || 'none'
  const model = result?.model || providerName || 'the model'
  if (result?.thinking) {
    return {
      message: `${model} streamed reasoning only — no answer text and no tool calls (stop reason: ${stop}).`,
      hint: 'The reply was cut off before the content stage. Send the message again, ask for a smaller change, or switch model in Settings.',
    }
  }
  if (stop === 'length' || stop === 'max_tokens') {
    return {
      message: `${model} hit its output token limit before producing any content (stop reason: ${stop}).`,
      hint: 'Ask for a smaller change, or use a model with a larger max output token budget.',
    }
  }
  if (stop === 'content_filter') {
    return {
      message: `${model} returned an empty response because the provider filtered it (stop reason: content_filter).`,
      hint: 'Rephrase the request.',
    }
  }
  return {
    message: `${model} returned an empty response — no text and no tool calls (stop reason: ${stop}).`,
    hint: 'Retry the message. If it repeats, check the model name and base URL in Settings.',
  }
}

/** Anthropic-shaped content blocks for a user message: images first, then text. */
function userBlocks(text, images = []) {
  return [
    ...(Array.isArray(images) && images.length
      ? images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType || 'image/png', data: img.data },
      }))
      : []),
    { type: 'text', text: String(text || '') },
  ]
}

/**
 * Run one agent turn: stream the model, execute its tool calls, feed build
 * errors back in, and keep going until the model stops or the step cap hits.
 *
 * Contract: this always emits exactly one terminal event — `turn:end` on
 * success, `turn:error` on failure, `turn:aborted` when the user stops it — so
 * the UI can never be left waiting on a turn that produced nothing.
 */
export async function runAgentTurn({
  project,
  userMessage,
  settings,
  mode = 'agent',
  provider,
  signal,
  images = [],
  steering = null,
}) {
  const persisted = [{ role: 'user', content: [{ type: 'text', text: userMessage }] }]

  const terminal = { done: false }
  const fail = (message, extra = {}) => {
    if (terminal.done) return false
    terminal.done = true
    emit(project.id, 'turn:error', {
      message: String(message || 'The agent stopped without producing a response.'),
      ...extra,
    })
    return true
  }
  const finish = (payload) => {
    if (terminal.done) return false
    terminal.done = true
    emit(project.id, 'turn:end', payload)
    return true
  }

  let steps = 0
  let totalInput = 0
  let totalOutput = 0
  let finalText = ''
  let aborted = false
  // Function-scoped so the abort/error paths can hand undelivered steering back.
  let steered = 0
  const leftoverSteering = []

  try {
    const tree = await listProjectTree(project.path)
    const history = await loadHistory(project.id)
    const skillsText = await skillsBrief(project.skillIds)
    const activeProvider = provider || settings.provider
    const imageText = mode === 'agent' ? imageBrief(settings, activeProvider) : ''
    const personas = settings.personas || {}
    const system = systemPrompt(project, tree, mode, skillsText, imageText, personas)

    const userContent = userBlocks(userMessage, images)

    // Build messages array, injecting assistant persona on first turn if provided
    const assistantPersona = personas.assistant || ''
    const messages = [
      ...trimHistory(history),
      // If this is the first turn and assistant persona is set, inject it as initial assistant message
      ...(history.length === 0 && assistantPersona ? [{ role: 'assistant', content: assistantPersona }] : []),
      { role: 'user', content: userContent },
    ]

    /* Mid-turn steering. The HTTP route owns `steering.inbox`; anything the user
     * types while this turn runs lands there. Draining is only safe at the top
     * of an iteration, where `messages` ends with a user turn or a tool_result
     * block — injecting anywhere else would split an assistant tool_use from
     * its results and the provider would reject the request. */
    const takeSteering = () => {
      if (!steering?.inbox?.length) return []
      return steering.inbox.splice(0, steering.inbox.length)
    }
    const injectSteering = (items) => {
      for (const item of items) {
        const content = userBlocks(item.text, item.images)
        messages.push({ role: 'user', content })
        persisted.push({ role: 'user', content })
        steered++
        emit(project.id, 'turn:steered', {
          text: item.text,
          images: item.images?.length || 0,
          step: steps,
          at: item.at || Date.now(),
          queuedAt: item.queuedAt || null,
        })
      }
    }

    emit(project.id, 'turn:start', { mode, model: settings[canonicalProvider(activeProvider)]?.model })

    const maxSteps = settings.agent?.maxSteps ?? 24
    const changedFiles = new Set()
    const toolContext = { root: project.path, settings, provider: activeProvider, signal }
    let buildErrorReported = false
    let emptyRetries = 0

    while (steps < maxSteps) {
      if (signal?.aborted) {
        aborted = true
        emit(project.id, 'turn:aborted', {})
        break
      }
      steps++

      const arrived = takeSteering()
      if (arrived.length) injectSteering(arrived)

      const result = await streamWithRetry({
        settings,
        provider,
        system,
        messages,
        tools: mode === 'agent' ? [...TOOL_DEFINITIONS, ...aggregatedTools()] : [],
        signal,
        onText: (delta) => emit(project.id, 'assistant:delta', { delta, step: steps }),
        onThinking: (delta) => emit(project.id, 'assistant:thinking', { delta, step: steps }),
        onToolStart: (call) => emit(project.id, 'tool:start', { id: call.id, name: call.name, step: steps }),
      }, project.id)

      totalInput += result.usage?.inputTokens ?? 0
      totalOutput += result.usage?.outputTokens ?? 0
      finalText = result.text || finalText

      const hasText = Boolean(result.text && result.text.trim())
      const hasTools = Boolean(result.toolCalls?.length)

      // A response with neither text nor tool calls is the classic silent stop:
      // the loop would break, the turn would "end", and the user would see
      // nothing. Retry briefly, then report it as a proper error.
      if (!hasText && !hasTools) {
        if (emptyRetries < EMPTY_RESPONSE_RETRIES && !signal?.aborted) {
          emptyRetries++
          steps--
          emit(project.id, 'system:notice', {
            message: `Empty response from ${result.model || activeProvider} (stop reason: ${result.stopReason || 'none'}) — retrying.`,
          })
          await new Promise((resolve) => setTimeout(resolve, EMPTY_RESPONSE_DELAY))
          continue
        }
        const problem = emptyResponseError(result, activeProvider)
        persisted.push({ role: 'assistant', content: [{ type: 'text', text: `_(error: ${problem.message})_` }] })
        await safeAppendHistory(project.id, persisted)
        fail(problem.message, { hint: problem.hint, empty: true, stopReason: result.stopReason || null })
        return { text: '', steps, usage: { inputTokens: totalInput, outputTokens: totalOutput }, commit: null, error: problem.message }
      }
      emptyRetries = 0

      // Persist reasoning (if any) alongside the answer so it can be re-shown
      // collapsed on reload. It is never fed back to the model: both adapters
      // drop unknown block types when rebuilding the request.
      if (result.thinking || hasText) {
        const blocks = []
        if (result.thinking) blocks.push({ type: 'thinking', thinking: result.thinking })
        if (hasText) blocks.push({ type: 'text', text: result.text })
        persisted.push({ role: 'assistant', content: blocks })
      }

      if (hasText) {
        messages.push({ role: 'assistant', content: [{ type: 'text', text: result.text }] })
        emit(project.id, 'assistant:text', { text: result.text, step: steps })
      }

      if (mode !== 'agent' || !hasTools) {
        // In plan mode, or when the model produced no tool calls, the turn is
        // over — unless the user spoke while the last step was streaming. Then
        // one more step answers them instead of throwing the message away.
        const late = takeSteering()
        if (late.length) {
          if (mode === 'agent' && steps < maxSteps && !signal?.aborted) {
            injectSteering(late)
            continue
          }
          leftoverSteering.push(...late)
        }
        break
      }

      // Assistant turn must carry the tool_use blocks so results can attach.
      if (hasText) messages.pop()
      messages.push({
        role: 'assistant',
        content: [
          ...(hasText ? [{ type: 'text', text: result.text }] : []),
          ...result.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args })),
        ],
      })

      const toolResults = []
      for (const call of result.toolCalls) {
        if (signal?.aborted) break

        if (call.args?.__parseError) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: 'ERROR: tool arguments were not valid JSON. Retry with well-formed arguments.',
            is_error: true,
          })
          emit(project.id, 'tool:end', { id: call.id, name: call.name, ok: false, result: 'invalid JSON arguments' })
          continue
        }

        emit(project.id, 'tool:args', { id: call.id, name: call.name, args: redactArgs(call.name, call.args) })

        const output = await executeTool(call.name, call.args, {
          ...toolContext,
          onLog: (text) => emit(project.id, 'tool:log', { id: call.id, name: call.name, text }),
        })

        const ok = !output.startsWith('ERROR:') && !output.startsWith('Refused:')
        if (isMutating(call.name) && ok) changedFiles.add(call.args?.path || call.name)
        if (call.name === 'image_generation' && ok) {
          changedFiles.add(call.args?.path || path.join('public', 'generated'))
          emit(project.id, 'file:written', { path: call.args?.path || 'public/generated', by: 'agent' })
        }
        if (call.name === 'run_command' && /npm\s+(install|i|add)\b/.test(call.args?.command || '')) {
          emit(project.id, 'deps:changed', {})
        }

        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: output, is_error: !ok })
        emit(project.id, 'tool:end', {
          id: call.id,
          name: call.name,
          ok,
          result: output.length > 1200 ? `${output.slice(0, 1200)}\n… truncated` : output,
        })
      }

      messages.push({ role: 'user', content: toolResults })

      // Self-healing: if the dev server broke because of these edits, hand the
      // error straight back instead of waiting for the user to notice.
      const devServer = manager.peek(project.id)
      if (devServer?.status === 'error' && devServer.lastError && !buildErrorReported) {
        buildErrorReported = true
        messages.push({
          role: 'user',
          content: [{
            type: 'text',
            text: `The dev server reported a build error after your changes:\n\n${devServer.lastError.slice(0, 3000)}\n\nFix it now.`,
          }],
        })
        emit(project.id, 'agent:selfheal', { error: devServer.lastError.slice(0, 500) })
      }

      // package.json edits need an install before the next import resolves.
      if ([...changedFiles].some((f) => String(f).endsWith('package.json')) && settings.agent?.autoInstall !== false) {
        const installOut = await executeTool('run_command', { command: 'npm install --no-audit --no-fund' }, toolContext)
        messages.push({
          role: 'user',
          content: [{ type: 'text', text: `package.json changed, so dependencies were installed automatically.\n\n${installOut.slice(-1500)}` }],
        })
        changedFiles.clear()
        emit(project.id, 'deps:changed', {})
      }
    }

    // Anything still queued (abort, step cap, plan mode) goes back to the route
    // so it can open a follow-up turn instead of silently dropping the message.
    leftoverSteering.push(...takeSteering())

    if (steps >= maxSteps) {
      emit(project.id, 'turn:maxsteps', { maxSteps })
    }

    const usage = { inputTokens: totalInput, outputTokens: totalOutput }
    if (mode === 'agent') await addProjectUsage(project.id, usage)

    let commit = null
    const reviewMode = settings.agent?.reviewCommit === true
    if (mode === 'agent' && reviewMode) {
      // Hold the changes for a human decision instead of committing blindly.
      const pending = await gitStatusShort(project.path)
      if (pending.length) {
        emit(project.id, 'review:pending', { files: pending.map((p) => p.file) })
      }
    } else if (mode === 'agent' && settings.agent?.autoCommit !== false) {
      try {
        const pending = await gitStatusShort(project.path)
        if (pending.length) {
          const message = commitMessage(userMessage, pending)
          commit = await gitCommitAll(project.path, message)
          emit(project.id, 'git:commit', { ...commit, files: pending.length })
        }
      } catch (err) {
        emit(project.id, 'git:error', { message: err.message })
      }
    }

    const historyError = await safeAppendHistory(project.id, persisted)
    await touchProject(project.id)

    if (historyError) {
      // The work happened but could not be recorded — that is still a failure
      // the user has to hear about, not a silent success.
      fail(`The turn completed but the conversation could not be saved: ${historyError.message}`, {
        hint: `Check that ${project.id ? 'the data directory' : 'data/meta'} is writable.`,
      })
      return { text: finalText, steps, usage, commit, error: historyError.message }
    }

    finish({ steps, usage, commit, aborted, steered })
    return { text: finalText, steps, usage, commit, aborted, steered, leftoverSteering }
  } catch (err) {
    const aborted = signal?.aborted || err?.name === 'AbortError' || /aborted/i.test(err?.message || '')
    if (aborted) {
      persisted.push({ role: 'assistant', content: [{ type: 'text', text: '_(stopped by user)_' }] })
      await safeAppendHistory(project.id, persisted)
      emit(project.id, 'turn:aborted', {})
      terminal.done = true
      return {
        text: finalText,
        steps,
        usage: { inputTokens: totalInput, outputTokens: totalOutput },
        commit: null,
        aborted: true,
        steered,
        // Left in the inbox on purpose: the route reports undelivered steering.
        leftoverSteering,
      }
    }

    persisted.push({ role: 'assistant', content: [{ type: 'text', text: `_(error: ${err.message})_` }] })
    await safeAppendHistory(project.id, persisted)
    fail(err.message, { hint: err.hint })
    err.emitted = true
    throw err
  }
}

function isMutating(name) {
  return name === 'write_file' || name === 'edit_file' || name === 'delete_file'
}

/** Tool arguments can contain whole files; keep the event stream small. */
function redactArgs(name, args = {}) {
  const out = { ...args }
  for (const key of ['content', 'old_string', 'new_string']) {
    if (typeof out[key] === 'string' && out[key].length > 400) {
      out[key] = `${out[key].slice(0, 400)}… (${out[key].length} chars)`
    }
  }
  return out
}

function commitMessage(userMessage, changed) {
  const subject = String(userMessage || 'Update').replace(/\s+/g, ' ').trim().slice(0, 72)
  const files = changed.map((c) => c.file).slice(0, 8)
  return `${subject || 'Update project'}\n\n${files.join('\n')}${changed.length > 8 ? `\n… +${changed.length - 8} more` : ''}`
}

export { systemPrompt }
