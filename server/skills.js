/* A library of reusable "skills" — focused instruction packs the agent follows
 * when they are enabled for a project. Built-in skills ship with the app; user
 * skills are created in the UI and persisted to data/skills.json. A skill is
 * just a curated brief injected into the system prompt, so enabling one steers
 * how the agent builds without changing any code. Purely local — no network. */

import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_DIR, readJson, writeJsonAtomic } from './config.js'

const SKILLS_FILE = path.join(DATA_DIR, 'skills.json')

export const BUILTIN_SKILLS = [
  {
    id: 'accessibility',
    name: 'Accessibility',
    icon: '♿',
    description: 'Semantic HTML, keyboard navigation, visible focus, ARIA only where needed, WCAG AA contrast.',
    tags: ['a11y', 'inclusive', 'quality'],
    brief: `Skill: ACCESSIBILITY. Build to WCAG 2.1 AA.
- Use semantic elements (button, nav, main, label, heading order) before reaching for ARIA; add ARIA only when a native element cannot express the state.
- Every interactive element is reachable and operable by keyboard, with a visible focus ring (never remove outline without a replacement).
- Form inputs have associated <label>s; errors are announced (aria-invalid, aria-describedby).
- Images carry alt text (empty alt="" for decorative). Maintain a contrast ratio of at least 4.5:1 for body text.
- Respect prefers-reduced-motion by toning down animation.`,
  },
  {
    id: 'responsive',
    name: 'Responsive layout',
    icon: '📱',
    description: 'Mobile-first fluid layouts, sensible breakpoints, no horizontal scroll, touch-friendly targets.',
    tags: ['mobile', 'layout', 'css'],
    brief: `Skill: RESPONSIVE LAYOUT. Design mobile-first.
- Base styles target small screens; layer larger layouts with min-width breakpoints (sm/md/lg/xl). Prefer fluid units (%, fr, clamp(), min()/max()) over fixed pixels.
- No horizontal scrolling at any width. Long words and code wrap or scroll within their own container.
- Grids collapse to a single column on narrow screens; navigation becomes a drawer or stacked menu.
- Interactive targets are at least 40x40px with comfortable spacing for touch.
- Test mentally at 375px, 768px and 1280px before finishing.`,
  },
  {
    id: 'forms-validation',
    name: 'Forms & validation',
    icon: '✅',
    description: 'Controlled inputs, inline validation, clear error and success states, disabled-while-submitting.',
    tags: ['forms', 'ux', 'validation'],
    brief: `Skill: FORMS & VALIDATION.
- Inputs are controlled; validate on blur and on submit, showing inline field-level errors next to the offending input, plus a summary for the whole form when useful.
- Disable the submit button and show a pending state while a request is in flight; re-enable and surface server errors on failure.
- Mark required fields, use appropriate input types (email, tel, number, password) and autocomplete hints.
- Show a clear success confirmation. Never lose the user's typed values on a validation failure.`,
  },
  {
    id: 'loading-states',
    name: 'Loading & empty states',
    icon: '⏳',
    description: 'Skeletons, spinners, error fallbacks and empty states for every async view.',
    tags: ['ux', 'async', 'polish'],
    brief: `Skill: LOADING & EMPTY STATES. Every async view handles all four states.
- Loading: skeletons that match the final layout (preferred) or a spinner; never a blank screen.
- Empty: a friendly, actionable empty state that explains what goes there and how to add the first item.
- Error: a readable message with a retry action; never dump a raw stack trace on the user.
- Success: the real content. Keep transitions between states smooth and avoid layout shift.`,
  },
  {
    id: 'motion',
    name: 'Motion & animation',
    icon: '✨',
    description: 'Purposeful transitions, keyframes and micro-interactions that respect prefers-reduced-motion.',
    tags: ['animation', 'polish', 'css'],
    brief: `Skill: MOTION & ANIMATION. Add motion with intent, not decoration.
- Animate state changes the user should notice: hover/active affordances, enter/exit of lists and modals, value changes, loading progress.
- Prefer transform and opacity (composited, cheap) over animating layout properties. Keep durations short (~120–300ms) with natural easing.
- Wrap non-essential motion in a prefers-reduced-motion media query that reduces or removes it.
- For complex sequences reach for a library (framer-motion) and install it before importing.`,
  },
  {
    id: 'dark-mode',
    name: 'Dark mode',
    icon: '🌗',
    description: 'Theme tokens, a toggle, system-preference default and persisted choice.',
    tags: ['theme', 'dark', 'css'],
    brief: `Skill: DARK MODE. Support light and dark themes.
- Define color tokens once (CSS variables in an @theme block or :root) and consume them everywhere; never hardcode hex values in components.
- Provide a theme toggle; default to the user's system preference (prefers-color-scheme) and persist an explicit choice to localStorage.
- Ensure both themes meet contrast requirements — dark mode is not just inverted colors; adjust surface elevation and accent tones per theme.`,
  },
  {
    id: 'data-fetching',
    name: 'Data fetching',
    icon: '🔌',
    description: 'Clean async data patterns: caching, retries, request cancellation and typed responses.',
    tags: ['data', 'api', 'async'],
    brief: `Skill: DATA FETCHING. Handle remote data robustly.
- Centralize fetching (a small api client or TanStack Query) rather than scattering raw fetch calls through components; install the library before importing it.
- Type responses with TypeScript interfaces. Handle network errors, non-2xx statuses and timeouts.
- Cancel or ignore stale requests when a component unmounts or params change (AbortController) to avoid race conditions and state updates after unmount.
- Cache where it helps and show the loading/error states described by the Loading & empty states skill.`,
  },
  {
    id: 'state-management',
    name: 'State management',
    icon: '🗂️',
    description: 'Right-size state: local first, lift only when shared, reach for a store only when it earns its place.',
    tags: ['architecture', 'state', 'react'],
    brief: `Skill: STATE MANAGEMENT. Keep state as local and simple as possible.
- Start with component-local state; lift to the nearest common parent only when two components truly share it.
- Derive values during render instead of duplicating them into state. Keep server data (fetched) separate from UI state.
- Introduce context for cross-cutting concerns (theme, auth, current user) and a store like Zustand only when prop-drilling becomes genuinely painful — do not start there.
- Colocate state with the components that use it and avoid one giant global object.`,
  },
  {
    id: 'performance',
    name: 'Performance',
    icon: '⚡',
    description: 'Code splitting, lazy routes, memoization where it matters, and optimized images.',
    tags: ['performance', 'optimization', 'react'],
    brief: `Skill: PERFORMANCE. Ship something that stays fast as it grows.
- Lazy-load routes and heavy components (React.lazy + Suspense) so the initial bundle stays small.
- Memoize only measured hotspots (React.memo, useMemo, useCallback) — do not wrap everything; premature memoization adds complexity for no gain.
- Optimize images: correct sizing, modern formats, lazy-load below-the-fold media.
- Avoid layout thrash and unnecessary re-renders; keep lists keyed with stable ids. Prefer CSS for animation.`,
  },
  {
    id: 'data-viz',
    name: 'Charts & data viz',
    icon: '📊',
    description: 'Responsive, accessible charts with recharts, plus a tabular fallback for the underlying data.',
    tags: ['charts', 'analytics', 'recharts'],
    brief: `Skill: CHARTS & DATA VISUALIZATION.
- Use a charting library (recharts is a good default) and install it before importing.
- Charts are responsive (fill their container) and themed to match the app's tokens, with clear axes, legends, units and tooltips.
- Do not rely on color alone to encode meaning; provide an accessible table fallback or aria labels for the data.
- Handle empty and single-point datasets gracefully instead of rendering a broken axis.`,
  },
  {
    id: 'seo-metadata',
    name: 'SEO & metadata',
    icon: '🔍',
    description: 'Document titles, meta descriptions, semantic headings and Open Graph tags per route.',
    tags: ['seo', 'metadata', 'marketing'],
    brief: `Skill: SEO & METADATA.
- Set a descriptive document title and meta description per route/view; keep headings in a single logical hierarchy (one h1, no skipped levels).
- Add Open Graph and Twitter card tags for shareable pages, and a canonical URL where relevant.
- Use descriptive, human-readable route paths and meaningful link text (not "click here").
- Provide alt text for images and ensure the page renders meaningful content without client-side-only tricks that crawlers miss.`,
  },
  {
    id: 'testing',
    name: 'Testing',
    icon: '🧪',
    description: 'Vitest + Testing Library: behavior-focused component tests and a repeatable test command.',
    tags: ['testing', 'quality', 'vitest'],
    brief: `Skill: TESTING. Add tests that describe behavior, not implementation.
- Use Vitest with @testing-library/react and @testing-library/user-event; install them (and jsdom) as dev dependencies before importing.
- Query by role/label/text the way a user finds elements; assert on visible outcomes and accessible states rather than internal details.
- Cover the critical paths: rendering, user interaction, validation and error handling. Keep tests fast and independent.
- Add a "test" script to package.json and make sure the suite passes before finishing.`,
  },
]

const BY_ID = new Map(BUILTIN_SKILLS.map((s) => [s.id, { ...s, builtin: true }]))

/* ------------------------------ user skills ------------------------------ */

async function loadUserSkills() {
  const data = await readJson(SKILLS_FILE, { skills: [] })
  return Array.isArray(data.skills) ? data.skills : []
}

async function saveUserSkills(skills) {
  await writeJsonAtomic(SKILLS_FILE, { skills, updatedAt: Date.now() })
}

function normalizeSkill(input, existing = {}) {
  const name = String(input.name || '').trim()
  if (!name) throw Object.assign(new Error('name is required'), { status: 400 })
  const brief = String(input.brief || '').trim()
  if (!brief) throw Object.assign(new Error('brief is required'), { status: 400 })
  const tags = Array.isArray(input.tags)
    ? input.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
    : String(input.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8)
  return {
    id: existing.id || `user-${randomUUID().slice(0, 8)}`,
    name,
    icon: String(input.icon || '🧩').trim() || '🧩',
    description: String(input.description || '').trim(),
    tags,
    brief,
    builtin: false,
    // Provenance, so a factory download can be recognised and re-downloaded.
    source: existing.source || input.source || 'user',
    origin: existing.origin ?? input.origin ?? null,
    homepage: existing.homepage ?? input.homepage ?? null,
    version: existing.version ?? input.version ?? null,
    author: existing.author ?? input.author ?? null,
    createdAt: existing.createdAt || Date.now(),
    updatedAt: Date.now(),
  }
}

/** Full catalog (built-in + user) for the picker UI, built-in skills first. */
export async function skillCatalog() {
  const user = await loadUserSkills()
  return [
    ...BUILTIN_SKILLS.map(({ id, name, icon, description, tags }) => ({
      id, name, icon, description, tags, builtin: true,
    })),
    ...user.map(({ id, name, icon, description, tags, source, origin, version, createdAt, updatedAt }) => ({
      id, name, icon, description, tags, builtin: false,
      source: source || 'user', origin: origin || null, version: version || null,
      createdAt, updatedAt,
    })),
  ]
}

/**
 * Add a downloaded factory skill. Re-downloading the same skill updates the
 * existing copy instead of leaving two identical entries in the library.
 */
export async function installSkill(doc) {
  const user = await loadUserSkills()
  const origin = doc?.origin || null
  const index = origin ? user.findIndex((s) => s.origin === origin) : -1
  if (index === -1) return createSkill(doc)
  const next = normalizeSkill({ ...user[index], ...doc }, user[index])
  user[index] = next
  await saveUserSkills(user)
  return next
}

/** Resolve one skill (built-in or user) by id, including its brief. */
export async function getSkill(id) {
  if (!id) return null
  if (BY_ID.has(id)) return BY_ID.get(id)
  const user = await loadUserSkills()
  return user.find((s) => s.id === id) || null
}

export async function createSkill(input) {
  const skill = normalizeSkill(input)
  const user = await loadUserSkills()
  user.push(skill)
  await saveUserSkills(user)
  return skill
}

export async function updateSkill(id, input) {
  const user = await loadUserSkills()
  const index = user.findIndex((s) => s.id === id)
  if (index === -1) throw Object.assign(new Error('Only user-created skills can be edited'), { status: 400 })
  const next = normalizeSkill({ ...user[index], ...input }, user[index])
  user[index] = next
  await saveUserSkills(user)
  return next
}

/** Delete a user skill. Returns true on success; built-ins cannot be deleted. */
export async function deleteSkill(id) {
  if (BY_ID.has(id)) throw Object.assign(new Error('Built-in skills cannot be deleted'), { status: 400 })
  const user = await loadUserSkills()
  const next = user.filter((s) => s.id !== id)
  if (next.length === user.length) return false
  await saveUserSkills(next)
  return true
}

/**
 * The system-prompt fragment for a list of enabled skill ids, or '' when none.
 * Unknown ids are ignored so a deleted user skill never breaks a turn.
 */
export async function skillsBrief(ids) {
  if (!Array.isArray(ids) || !ids.length) return ''
  const resolved = []
  for (const id of ids) {
    const skill = await getSkill(id)
    if (skill) resolved.push(skill)
  }
  if (!resolved.length) return ''
  const body = resolved.map((s) => `### ${s.name}\n${s.brief}`).join('\n\n')
  return `\n## Skills enabled for this project\nFollow every instruction below; they are part of the project's requirements.\n\n${body}\n`
}
