/* Stillworks — control panel frontend. Zero dependencies, no build step. */

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

/** Default system and assistant personas */
const DEFAULT_SYSTEM_PERSONA = `You are an expert full-stack developer specializing in React, TypeScript, Next.js, Vue, and modern web frameworks. You write clean, maintainable code following best practices. You understand component architecture, state management, API integration, and deployment strategies. When building projects, you create complete, working implementations rather than placeholders.`

const DEFAULT_ASSISTANT_PERSONA = `I'll help you build this step by step. Let me analyze the requirements and project structure first, then implement the solution systematically.`

const state = {
  projects: [],
  /** Folders under data/projects/ with no registry entry, and data/.trash/. */
  orphans: [],
  trash: [],
  /** Origin URL of the active project, when it has one. */
  remote: null,
  activeId: null,
  settings: null,
  providers: null,
  health: null,
  designs: [],
  designFilter: '',
  skills: [],
  skillFilter: '',
  editingSkillId: null,
  /** Skill factory catalog, loaded the first time the search field is used. */
  factory: null,
  factoryOrigin: null,
  factoryLoading: false,
  factoryError: null,
  factoryWarning: null,
  previewFactoryId: null,
  templates: [],
  pendingImages: [],
  searchTimer: null,
  view: 'preview',
  mode: 'agent',
  events: null,
  agentRunning: false,
  selectedFile: null,
  editorDirty: false,
  consoleLines: [],
  logs: [],
  commits: [],
  selectedCommit: null,
  /** tool call id -> DOM element */
  toolNodes: new Map(),
  /** steering queuedAt -> DOM element, so the badge can flip once delivered */
  steerNodes: new Map(),
  currentAssistantEl: null,
  currentAssistantText: '',
  /** bouncing-dots placeholder element shown while the agent spins up */
  waitingEl: null,
  /** text of the most recent completed assistant turn, for suggestion parsing */
  lastAssistantText: '',
  /** element-picking mode in the preview iframe */
  selecting: false,
  selectedElement: null,
  currentThinkingEl: null,
  currentThinkingText: '',
  thinkingStartedAt: 0,
  reconnectTimer: null,
}

/* -------------------------------- helpers ------------------------------- */

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status
    err.payload = data
    throw err
  }
  return data
}

function toast(message, kind = '') {
  const root = $('#toast-root')
  const node = document.createElement('div')
  node.className = `toast ${kind}`
  node.textContent = message
  root.appendChild(node)
  setTimeout(() => {
    node.style.opacity = '0'
    node.style.transition = 'opacity 0.3s'
    setTimeout(() => node.remove(), 320)
  }, 3200)
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'html') node.innerHTML = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value)
    else node.setAttribute(key, value)
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    node.append(child.nodeType ? child : document.createTextNode(String(child)))
  }
  return node
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

/* ------------------------------ sliding pill ----------------------------- */

/** Attach a sliding indicator to a tab-button group. */
function initSlider(group) {
  if (!group || group.querySelector('.tab-slider')) return
  group.append(el('span', { class: 'tab-slider' }))
  updateSlider(group)
}

/** Move the indicator onto the group's active button. */
function updateSlider(group) {
  if (!group) return
  const slider = group.querySelector('.tab-slider')
  const active = group.querySelector('.active')
  if (!slider || !active) return
  const hidden = active.offsetParent === null
  slider.style.visibility = hidden ? 'hidden' : 'visible'
  if (hidden) return
  slider.style.left = `${active.offsetLeft}px`
  slider.style.top = `${active.offsetTop}px`
  slider.style.width = `${active.offsetWidth}px`
  slider.style.height = `${active.offsetHeight}px`
}

function activeProject() {
  return state.projects.find((p) => p.id === state.activeId) || null
}

/** Compact token counts: 1234 -> "1.2K", 4500000 -> "4.5M". */
function formatTokens(n) {
  const value = Number(n) || 0
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${trimZero(value / 1e9)}B`
  if (abs >= 1e6) return `${trimZero(value / 1e6)}M`
  if (abs >= 1e3) return `${trimZero(value / 1e3)}K`
  return String(value)
}

function trimZero(value) {
  return String(Number(value.toFixed(1)))
}

/** The exact figure, for tooltips under the compact label. */
function exactTokens(n) {
  return (Number(n) || 0).toLocaleString('en-US')
}

function timeAgo(ts) {
  if (!ts) return ''
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

/* ------------------------------ file icons ------------------------------ */

const FILE_ICONS = {
  js: '🟨', mjs: '🟨', cjs: '🟨',
  jsx: '⚛️', tsx: '⚛️',
  ts: '🔷', d: '🔷',
  vue: '🟢', svelte: '🧡',
  css: '🎨', scss: '🎨', sass: '🎨', less: '🎨',
  html: '🌐', htm: '🌐',
  json: '🧩', jsonc: '🧩',
  md: '📝', mdx: '📝', txt: '📄',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️', ico: '🖼️', avif: '🖼️',
  lock: '🔒',
  yml: '⚙️', yaml: '⚙️', toml: '⚙️', ini: '⚙️', config: '⚙️',
  env: '🔐',
  sh: '💻', bash: '💻',
  ico: '🖼️',
  map: '🗺️',
  sql: '🗄️',
  log: '📜',
  zip: '🗜️', tgz: '🗜️',
}

/** Emoji glyph for a file name, keyed off its extension / known dotfiles. */
function fileIcon(name) {
  const lower = String(name).toLowerCase()
  if (lower === 'package.json' || lower === 'package-lock.json') return '📦'
  if (lower === 'tsconfig.json') return '🔷'
  if (lower === 'tailwind.config.js' || lower === 'postcss.config.js') return '🎨'
  if (lower === 'vite.config.ts' || lower === 'vite.config.js') return '⚡'
  if (lower === 'next.config.js' || lower === 'next.config.mjs') return '▲'
  if (lower.startsWith('.')) return '⚙️'
  const ext = lower.includes('.') ? lower.split('.').pop() : ''
  return FILE_ICONS[ext] || '📄'
}

/* --------------------------------- theme -------------------------------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem('lovable-theme', theme) } catch { /* private mode */ }
  const btn = $('#theme-toggle')
  if (btn) {
    btn.textContent = theme === 'light' ? '☀' : '☾'
    btn.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'
  }
}

function initTheme() {
  let theme = null
  try { theme = localStorage.getItem('lovable-theme') } catch { /* ignore */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  applyTheme(theme)
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')
}

/* ------------------------------- bootstrap ------------------------------ */

async function boot() {
  try {
    const [health, settings, providers, designs, skills, templates] = await Promise.all([
      api('/api/health'),
      api('/api/settings'),
      api('/api/providers'),
      api('/api/designs').catch(() => ({ designs: [] })),
      api('/api/skills').catch(() => ({ skills: [] })),
      api('/api/templates').catch(() => ({ templates: [] })),
    ])
    state.settings = settings
    state.providers = providers
    state.health = health
    state.designs = designs.designs || []
    state.skills = skills.skills || []
    state.templates = templates.templates || []
    renderTemplateChoices()
    renderProviderPill(health)
    renderVersionChip(health)
    renderImageSizeChoices()
    renderStartupWarnings(health)
    await refreshProjects()
    renderSettingsProviderChoices()
    $('#mock-banner').hidden = settings.provider !== 'mock'
  } catch (err) {
    toast(`Could not reach the server: ${err.message}`, 'error')
  }
  wireGlobalEvents()
  wireMcpEvents()
  wireConnectorEvents()
  loadMcpServers()
}

async function refreshProjects() {
  const data = await api('/api/projects')
  // Preserve live status for the active project if the server has it.
  const previous = new Map(state.projects.map((p) => [p.id, p]))
  state.projects = data.projects.map((p) => ({ ...previous.get(p.id), ...p }))
  state.orphans = data.orphans || []
  state.trash = data.trash || []
  renderSidebar()
  renderHome()
  if (state.activeId) {
    const still = state.projects.find((p) => p.id === state.activeId)
    if (!still) closeWorkspace()
    else renderTopbar()
  }
}

/* -------------------------------- sidebar ------------------------------- */

/** project id -> element, so status updates patch in place instead of
 *  rebuilding the list (which would detach nodes mid-click). */
const sidebarNodes = new Map()

function renderSidebar() {
  const list = $('#project-list')
  $('#project-count').textContent = state.projects.length

  const seen = new Set()

  for (const project of state.projects) {
    seen.add(project.id)
    const status = project.status || 'stopped'
    let node = sidebarNodes.get(project.id)

    if (!node || !node.isConnected) {
      node = el('button', { class: 'project-item', onclick: () => selectProject(project.id) },
        el('span', { class: 'dot' }),
        el('span', { class: 'pi-text' },
          el('span', { class: 'pi-name' }),
          el('span', { class: 'pi-sub' }),
        ),
      )
      sidebarNodes.set(project.id, node)
    }

    node.classList.toggle('active', project.id === state.activeId)
    node.title = `${project.name}\n${project.path}`
    node.querySelector('.dot').className = `dot ${status}`
    node.querySelector('.pi-name').textContent = project.name
    node.querySelector('.pi-sub').textContent = `:${project.port} · ${status}`
  }

  // Remove nodes for deleted projects, then append in registry order.
  for (const [id, node] of sidebarNodes) {
    if (!seen.has(id)) {
      node.remove()
      sidebarNodes.delete(id)
    }
  }
  list.replaceChildren(...state.projects.map((p) => sidebarNodes.get(p.id)).filter(Boolean))

  if (!state.projects.length && !list.querySelector('.empty-note')) {
    list.append(el('div', { class: 'empty-note' }, 'No projects yet'))
  }
}

let homeSignature = ''
const homeCards = new Map()

function renderHome() {
  const grid = $('#home-grid')
  const signature = state.projects.map((p) => `${p.id}:${p.name}:${p.slug}:${p.port}`).join('|')

  if (signature !== homeSignature) {
    homeSignature = signature
    homeCards.clear()
    grid.replaceChildren()

    for (const project of state.projects) {
      const card = el('div', { class: 'project-card', onclick: () => selectProject(project.id) },
        el('div', { class: 'pc-name', text: project.name }),
        el('div', { class: 'pc-meta' },
          el('span', { class: 'dot' }),
          el('span', { class: 'pc-slug' }),
        ),
        el('div', { class: 'muted small pc-updated' }),
        el('div', { class: 'pc-actions' },
          el('button', {
            class: 'btn btn-ghost btn-xs',
            onclick: (event) => { event.stopPropagation(); selectProject(project.id) },
          }, 'Open'),
          el('button', {
            class: 'btn btn-ghost btn-xs',
            onclick: (event) => { event.stopPropagation(); openRename(project) },
          }, 'Rename'),
          el('button', {
            class: 'btn btn-danger btn-xs',
            onclick: (event) => { event.stopPropagation(); confirmRemoveProject(project) },
          }, 'Remove'),
        ),
      )
      homeCards.set(project.id, card)
      grid.append(card)
    }

    if (!state.projects.length) {
      grid.append(el('div', { class: 'empty-note' }, 'Your projects will appear here.'))
    }
  }

  // Patch volatile fields in place so the 12s poll never detaches cards.
  for (const project of state.projects) {
    const card = homeCards.get(project.id)
    if (!card) continue
    card.querySelector('.dot').className = `dot ${project.status || 'stopped'}`
    card.querySelector('.pc-slug').textContent = `${project.slug} · :${project.port}`
    card.querySelector('.pc-updated').textContent = `updated ${timeAgo(project.updatedAt)}`
  }

  renderLeftovers()
}

/** Folders left on disk by a removal, and what currently sits in the trash. */
let leftoversSignature = ''

function renderLeftovers() {
  const root = $('#home-leftovers')
  if (!root) return
  const { orphans, trash } = state
  root.hidden = !orphans.length && !trash.length
  // The 12s poll re-enters here constantly; only rebuild when the content moved,
  // or a click can land on a node that has just been detached.
  const signature = `${orphans.map((o) => o.slug).join(',')}|${trash.map((t) => t.name).join(',')}`
  if (signature === leftoversSignature) return
  leftoversSignature = signature
  root.replaceChildren()

  if (orphans.length) {
    root.append(el('div', { class: 'leftover-group' },
      el('div', { class: 'leftover-title' }, `On disk but not in the list (${orphans.length})`),
      ...orphans.map((orphan) => el('div', { class: 'leftover-row' },
        el('span', { class: 'leftover-name mono', text: orphan.slug }),
        el('span', { class: 'leftover-path mono small muted', text: orphan.path }),
        el('span', { class: 'spacer' }),
        el('button', {
          class: 'btn btn-ghost btn-xs', title: 'Register this folder as a project',
          onclick: () => adoptOrphan(orphan),
        }, 'Adopt'),
        el('button', {
          class: 'btn btn-ghost btn-xs', title: 'Move the folder into data/.trash',
          onclick: () => confirmTrashOrphan(orphan),
        }, 'Move to trash'),
      )),
    ))
  }

  if (trash.length) {
    root.append(el('div', { class: 'leftover-group' },
      el('div', { class: 'leftover-title' },
        el('span', {}, `Trash (${trash.length})`),
        el('span', { class: 'spacer' }),
        el('button', {
          class: 'btn btn-ghost btn-xs', title: 'Delete every folder in the trash permanently',
          onclick: confirmEmptyTrash,
        }, 'Empty trash'),
      ),
      ...trash.map((item) => el('div', { class: 'leftover-row' },
        el('span', { class: 'leftover-name mono', text: item.name }),
        el('span', {
          class: 'leftover-path mono small muted',
          text: item.deletedAt ? `removed ${timeAgo(item.deletedAt)}` : '',
        }),
      )),
    ))
  }
}

async function adoptOrphan(orphan) {
  try {
    const project = await api('/api/projects/import', { method: 'POST', body: { dir: orphan.path } })
    toast(`Adopted ${project.slug}`, 'ok')
    await refreshProjects()
  } catch (err) {
    toast(err.message, 'error')
  }
}

function confirmTrashOrphan(orphan) {
  openConfirm(
    `Move "${orphan.slug}" to the trash?`,
    'The folder leaves data/projects/ and waits in data/.trash/. It is not deleted permanently while it is there.',
    async () => {
      try {
        await api(`/api/orphans/${encodeURIComponent(orphan.slug)}`, { method: 'DELETE' })
        toast(`Moved ${orphan.slug} to the trash`, 'ok')
        await refreshProjects()
      } catch (err) {
        toast(err.message, 'error')
      }
    },
  )
}

function confirmEmptyTrash() {
  const count = state.trash.length
  openConfirm(
    'Empty the trash?',
    `${count} folder${count === 1 ? '' : 's'} in data/.trash/ will be deleted permanently. This is the one removal that cannot be undone.`,
    async () => {
      try {
        const result = await api('/api/trash/empty', { method: 'POST' })
        toast(`Deleted ${result.removed} folder${result.removed === 1 ? '' : 's'}`, 'ok')
        await refreshProjects()
      } catch (err) {
        toast(err.message, 'error')
      }
    },
  )
}

function openRename(project) {
  openInput({
    title: 'Rename project',
    label: 'Display name',
    value: project.name,
    hint: `Only the name changes. The folder and slug stay "${project.slug}".`,
    onOk: async (name) => {
      const trimmed = name.trim()
      if (!trimmed) return
      try {
        await api(`/api/projects/${project.id}`, { method: 'PATCH', body: { name: trimmed } })
        toast(`Renamed to ${trimmed}`, 'ok')
        await refreshProjects()
      } catch (err) {
        toast(err.message, 'error')
      }
    },
  })
}

/**
 * Startup problems worth stating before the first failed scaffold: a missing
 * git/npm, or a registry written by a newer build (which this one will not touch).
 */
function renderStartupWarnings(health) {
  const banner = $('#prereq-banner')
  if (!banner) return
  const notes = []

  const missing = Object.entries(health?.prerequisites || {})
    .filter(([, result]) => !result.ok)
    .map(([tool]) => tool)
  if (missing.length) {
    notes.push(`${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not installed. Stillworks needs ${missing.length === 1 ? 'it' : 'them'} to create projects and run the preview — install ${missing.join(' and ')} and restart.`)
  }
  if (health?.registry?.readOnly) {
    notes.push(health.registry.readOnly)
  }

  banner.hidden = !notes.length
  banner.replaceChildren(...notes.flatMap((note, i) => (i ? [el('br'), document.createTextNode(note)] : [document.createTextNode(note)])))
}

function downloadDiagnostics() {
  const link = el('a', { href: '/api/diagnostics', download: '' })
  document.body.append(link)
  link.click()
  link.remove()
  toast('Diagnostics downloaded — API keys are masked in the file')
}

function renderProviderPill(health) {
  const ready = health?.providerReady
  const pill = $('#provider-pill')
  pill.innerHTML = ''
  pill.append(
    el('span', { class: `dot ${ready ? 'ok' : 'bad'}` }),
    el('span', {
      id: 'provider-pill-text',
      text: `${health?.provider || 'none'} · ${ready ? 'ready' : 'no key'}${health?.imageReady ? ' · 🖼' : ''}`,
    }),
  )
  pill.title = health?.imageReady
    ? `Model provider: ${health.provider}\nImage model: ${health.imageModel}`
    : `Model provider: ${health?.provider || 'none'}\nNo image model configured`
}

/** Sidebar version chip — click it for the full build identity. */
function renderVersionChip(health) {
  const chip = $('#open-about')
  if (!chip) return
  chip.textContent = `v${health?.version || '?'}`
  chip.title = `${health?.product || 'Stillworks'} · ${health?.company || 'CodeWoxy'}\nClick for build details`
}

function openAbout() {
  const health = state.health || {}
  $('#about-product').textContent = `${health.product || 'Stillworks'} v${health.version || '?'}`
  $('#about-company').textContent = health.company || 'CodeWoxy'

  const rows = [
    ['Product ID', health.productId || '—'],
    ['Version', health.version || '—'],
    ['Built by', health.company || '—'],
    ['Text provider', `${health.provider || '—'} · ${health.providerReady ? 'ready' : 'no key'}`],
    ['Image model', health.imageReady ? health.imageModel : 'not configured'],
    ['Projects', `${health.projects ?? '—'} (${health.running ?? 0} dev servers running)`],
    ['App directory', health.root || '—'],
    ['Data directory', health.dataDir || '—'],
  ]

  const list = $('#about-list')
  list.replaceChildren()
  for (const [label, value] of rows) {
    list.append(el('dt', { text: label }), el('dd', { class: 'mono', text: String(value) }))
  }

  const repo = $('#about-repo')
  if (health.repository) {
    repo.href = health.repository
    repo.hidden = false
  } else {
    repo.hidden = true
  }

  openModal('modal-about')
}

/* ------------------------------- workspace ------------------------------ */

async function selectProject(id) {
  state.activeId = id
  state.consoleLines = []
  state.logs = []
  state.commits = []
  state.selectedFile = null
  state.toolNodes.clear()

  $('#home').hidden = true
  $('#workspace').hidden = false
  state.waitingEl = null
  $('#chat-messages').replaceChildren()
  $('#console-body').replaceChildren()
  $('#console-count').textContent = '0'
  $('#console-strip').hidden = true
  $('#log-view').textContent = ''
  $('#editor').value = ''
  $('#editor').disabled = true
  $('#editor-path').textContent = 'no file selected'
  $('#btn-save').disabled = true
  const attach = $('#btn-attach')
  if (attach) attach.disabled = false
  state.steerNodes.clear()
  setAgentRunning(false)
  clearImages()
  hideReviewBar()
  clearSearchResults()
  state.selectedElement = null
  setSelectMode(false)
  renderElementRef()
  clearSuggestions()

  renderSidebar()
  renderTopbar()
  switchView(state.view)

  const project = activeProject()
  if (!project) return

  connectEvents(project)
  await loadChatHistory(project)
  await refreshWorkspace(project)

  if (project.status !== 'running') {
    setPreviewOverlay(`Starting ${project.slug} on port ${project.port}…\nFirst run installs dependencies, which takes about 20 seconds.`)
    try {
      await api(`/api/projects/${project.id}/start`, { method: 'POST' })
    } catch (err) {
      setPreviewOverlay(`Dev server failed to start:\n${err.message}`, true)
    }
  }
}

function closeWorkspace() {
  state.activeId = null
  disconnectEvents()
  $('#workspace').hidden = true
  $('#home').hidden = false
  const attach = $('#btn-attach')
  if (attach) attach.disabled = true
  state.steerNodes.clear()
  setAgentRunning(false)
  clearImages()
  hideReviewBar()
  renderSidebar()
}

function renderTopbar() {
  const project = activeProject()
  if (!project) return
  const status = project.status || 'stopped'
  $('#ws-name').textContent = project.name
  $('#ws-path').textContent = project.path
  $('#ws-port').textContent = `:${project.port}`

  const pill = $('#ws-status')
  pill.innerHTML = ''
  pill.append(el('i', { class: `dot ${status}` }), document.createTextNode(status))

  const usage = project.usage || {}
  const total = (usage.inputTokens || 0) + (usage.outputTokens || 0)
  $('#ws-usage').textContent = total
    ? `${formatTokens(usage.inputTokens || 0)}↑ ${formatTokens(usage.outputTokens || 0)}↓ · ${usage.turns || 0} turns`
    : ''
  $('#ws-usage').title = total
    ? `${exactTokens(total)} tokens total — ${exactTokens(usage.inputTokens || 0)} input, ${exactTokens(usage.outputTokens || 0)} output`
    : ''

  const openBtn = $('#btn-open')
  openBtn.href = project.previewUrl || '#'
  if (!project.previewUrl) openBtn.removeAttribute('href')
  $('#preview-url').textContent = project.previewUrl || ''

  updateDesignTrigger()
  updateSkillsTrigger()
}

/* -------------------------------- design -------------------------------- */

function currentDesign() {
  const project = activeProject()
  return state.designs.find((d) => d.id === project?.designId) || null
}

function updateDesignTrigger() {
  const btn = $('#btn-design')
  if (!btn) return
  const design = currentDesign()
  btn.querySelector('.dt-name').textContent = design ? design.name : 'Design'
  btn.classList.toggle('has-design', Boolean(design))
  btn.title = design ? `Design style: ${design.name} — click to change` : 'Pick a design style'
}

function renderDesignGrid() {
  const grid = $('#design-grid')
  if (!grid) return
  const q = state.designFilter.trim().toLowerCase()
  const project = activeProject()
  const matches = state.designs.filter((d) => !q
    || [d.name, d.description, ...(d.tags || [])].join(' ').toLowerCase().includes(q))

  grid.replaceChildren()
  if (!matches.length) {
    grid.append(el('div', { class: 'design-empty' }, 'No styles match that search.'))
    return
  }

  for (const design of matches) {
    const selected = project?.designId === design.id
    grid.append(el('button', {
      class: `design-card ${selected ? 'selected' : ''}`,
      onclick: () => selectDesign(design.id),
    },
      el('div', { class: 'dc-name' },
        el('span', { class: 'swatch-row' },
          ...(design.colors || []).map((c) => el('span', { class: 'swatch', style: `background:${c}` })),
        ),
        design.name,
      ),
      el('div', { class: 'dc-desc', text: design.description }),
      el('div', { class: 'dc-tags' },
        ...(design.tags || []).map((t) => el('span', { class: 'dc-tag', text: t })),
      ),
    ))
  }
}

function openDesign() {
  if (!activeProject()) { toast('Select a project first'); return }
  state.designFilter = ''
  const search = $('#design-search')
  search.value = ''
  renderDesignGrid()
  openModal('modal-design')
  setTimeout(() => search.focus(), 40)
}

async function selectDesign(designId) {
  const project = activeProject()
  if (!project) return
  try {
    const updated = await api(`/api/projects/${project.id}/design`, {
      method: 'PUT',
      body: { designId },
    })
    project.designId = updated.designId
    const design = state.designs.find((d) => d.id === designId)
    updateDesignTrigger()
    renderDesignGrid()
    toast(design ? `Design style set to ${design.name}` : 'Design style cleared', 'ok')
    closeModal()
  } catch (err) {
    toast(err.message, 'error')
  }
}

/* -------------------------------- skills -------------------------------- */

function projectSkillIds() {
  return activeProject()?.skillIds || []
}

/** Enabled ids that still resolve to a known skill — mirrors how the server
 *  ignores unknown ids when building the prompt, so the count stays honest
 *  even if a user skill was deleted out from under a project. */
function enabledSkillIds() {
  const known = new Set(state.skills.map((s) => s.id))
  return projectSkillIds().filter((id) => known.has(id))
}

function updateSkillsTrigger() {
  const btn = $('#btn-skills')
  if (!btn) return
  const count = enabledSkillIds().length
  btn.querySelector('.dt-name').textContent = count ? `Skills · ${count}` : 'Skills'
  btn.classList.toggle('has-design', count > 0)
  btn.title = count
    ? `${count} skill${count === 1 ? '' : 's'} enabled — click to change`
    : 'Enable skills for this project'
}

function renderSkillList() {
  const list = $('#skill-list')
  if (!list) return
  const q = state.skillFilter.trim().toLowerCase()
  const enabled = new Set(projectSkillIds())
  const matches = state.skills.filter((s) => !q
    || [s.name, s.description, ...(s.tags || [])].join(' ').toLowerCase().includes(q))

  const heading = $('#skill-list-heading')
  if (heading) heading.hidden = !state.factory
  list.replaceChildren()
  if (!matches.length) {
    list.append(el('div', { class: 'design-empty' }, state.factory
      ? 'None of your skills match that search — check the factory below.'
      : 'No skills match that search.'))
    updateSkillsCount()
    return
  }

  for (const skill of matches) {
    const on = enabled.has(skill.id)
    const card = el('div', { class: `skill-card ${on ? 'on' : ''}` },
      el('button', {
        type: 'button',
        class: 'skill-main',
        title: on ? 'Disable this skill' : 'Enable this skill',
        onclick: () => toggleSkill(skill.id),
      },
        el('span', { class: 'skill-check', text: on ? '✓' : '' }),
        el('span', { class: 'skill-icon', text: skill.icon || '🧩' }),
        el('span', { class: 'skill-text' },
          el('span', { class: 'dc-name' },
            skill.name,
            skill.builtin
              ? el('span', { class: 'skill-badge' }, 'built-in')
              : skill.source === 'factory'
                ? el('span', { class: 'skill-badge factory' }, 'factory')
                : null,
          ),
          el('span', { class: 'dc-desc', text: skill.description || '' }),
          el('span', { class: 'dc-tags' },
            ...(skill.tags || []).map((t) => el('span', { class: 'dc-tag', text: t })),
          ),
        ),
      ),
      skill.builtin ? null : el('div', { class: 'skill-edit-actions' },
        el('button', {
          type: 'button', class: 'btn btn-ghost btn-xs', title: 'Edit skill',
          onclick: () => openSkillEditor(skill),
        }, 'Edit'),
        el('button', {
          type: 'button', class: 'btn btn-danger btn-xs', title: 'Delete skill',
          onclick: () => confirmDeleteSkill(skill),
        }, '×'),
      ),
    )
    list.append(card)
  }
  updateSkillsCount()
}

function updateSkillsCount() {
  const label = $('#skills-enabled-count')
  if (!label) return
  const count = enabledSkillIds().length
  label.textContent = count
    ? `${count} enabled for this project`
    : 'No skills enabled for this project'
}

function openSkills() {
  if (!activeProject()) { toast('Select a project first'); return }
  state.skillFilter = ''
  const search = $('#skill-search')
  if (search) search.value = ''
  renderSkillList()
  renderFactory()
  openModal('modal-skills')
  setTimeout(() => search?.focus(), 40)
}

/* ----------------------------- skill factory ---------------------------- */

/**
 * Load the public catalog. Called when the search field is used, cached for
 * the session, and non-fatal: if the network is down the picker still works.
 */
async function loadFactory({ refresh = false } = {}) {
  if (state.factoryLoading) return
  if (state.factory && !refresh) { renderFactory(); return }
  state.factoryLoading = true
  state.factoryError = null
  renderFactory()
  try {
    const data = await api(`/api/skills/factory${refresh ? '?refresh=1' : ''}`)
    state.factory = data.skills || []
    state.factoryOrigin = data.origin
    state.factoryWarning = data.warning || null
  } catch (err) {
    state.factory = []
    state.factoryError = err.message
  } finally {
    state.factoryLoading = false
    renderFactory()
    renderSkillList()
  }
}

function renderFactory() {
  const box = $('#skill-factory')
  const list = $('#skill-factory-list')
  if (!box || !list) return
  if (!state.factory && !state.factoryLoading && !state.factoryError) { box.hidden = true; return }
  box.hidden = false

  const meta = $('#skill-factory-meta')
  const installed = new Set(state.skills.map((s) => s.origin).filter(Boolean))
  const q = state.skillFilter.trim().toLowerCase()

  if (state.factoryLoading && !state.factory) {
    if (meta) meta.textContent = 'loading…'
    list.replaceChildren(el('div', { class: 'design-empty' }, 'Fetching the skill catalog…'))
    return
  }
  if (state.factoryError && !state.factory?.length) {
    if (meta) meta.textContent = ''
    list.replaceChildren(el('div', { class: 'design-empty' }, `Catalog unavailable: ${state.factoryError}`))
    return
  }

  const matches = (state.factory || []).filter((s) => !q
    || [s.id, s.name, s.description, ...(s.tags || [])].join(' ').toLowerCase().includes(q))
  if (meta) {
    const offline = state.factoryOrigin === 'local'
    meta.textContent = `${matches.length} of ${state.factory.length}${offline ? ' · bundled copy (offline)' : ''}`
    meta.title = offline ? (state.factoryWarning || 'The remote catalog could not be reached') : ''
  }

  list.replaceChildren()
  if (!matches.length) {
    list.append(el('div', { class: 'design-empty' }, 'No factory skills match that search.'))
    return
  }
  for (const skill of matches) {
    const have = installed.has(skill.id)
    list.append(el('div', { class: `skill-card factory ${have ? 'installed' : ''}` },
      el('button', {
        type: 'button',
        class: 'skill-main',
        title: have ? 'Preview — download again to update' : 'Preview and download this skill',
        onclick: () => openSkillPreview(skill),
      },
        el('span', { class: 'skill-icon', text: skill.icon || '🧩' }),
        el('span', { class: 'skill-text' },
          el('span', { class: 'dc-name' },
            skill.name,
            el('span', { class: have ? 'skill-badge installed' : 'skill-badge download' },
              have ? 'installed' : 'download'),
          ),
          el('span', { class: 'dc-desc', text: skill.description || '' }),
          el('span', { class: 'dc-tags' },
            ...(skill.tags || []).map((t) => el('span', { class: 'dc-tag', text: t })),
          ),
        ),
      ),
    ))
  }
}

async function openSkillPreview(entry) {
  state.previewFactoryId = entry.id
  $('#skill-preview-title').textContent = entry.name || entry.id
  $('#skill-preview-desc').textContent = entry.description || ''
  $('#skill-preview-tags').replaceChildren(
    ...(entry.tags || []).map((t) => el('span', { class: 'dc-tag', text: t })),
  )
  $('#skill-preview-brief').textContent = 'Loading SKILL.md…'
  $('#skill-preview-meta').textContent = ''
  const install = $('#skill-preview-install')
  install.disabled = true
  install.textContent = 'Loading…'
  openModal('modal-skill-preview')

  try {
    const doc = await api(`/api/skills/factory/${encodeURIComponent(entry.id)}`)
    if (state.previewFactoryId !== entry.id) return
    $('#skill-preview-title').textContent = doc.name || entry.name
    $('#skill-preview-desc').textContent = doc.description || entry.description || ''
    $('#skill-preview-tags').replaceChildren(
      ...(doc.tags || []).map((t) => el('span', { class: 'dc-tag', text: t })),
    )
    $('#skill-preview-brief').textContent = doc.brief || '(this skill has no instructions)'
    $('#skill-preview-meta').textContent = [
      doc.version ? `v${doc.version}` : null,
      doc.author || null,
      doc.from === 'local' ? 'bundled copy' : null,
    ].filter(Boolean).join(' · ')
    install.disabled = false
    install.textContent = state.skills.some((s) => s.origin === entry.id) ? 'Update & enable' : 'Download & enable'
  } catch (err) {
    if (state.previewFactoryId !== entry.id) return
    $('#skill-preview-brief').textContent = `Could not download this skill.\n\n${err.message}`
    install.disabled = false
    install.textContent = 'Retry'
  }
}

/** Download the skill into the library, then enable it for the open project. */
async function installPreviewedSkill() {
  const id = state.previewFactoryId
  if (!id) return
  const install = $('#skill-preview-install')
  install.disabled = true
  install.textContent = 'Downloading…'
  try {
    const skill = await api(`/api/skills/factory/${encodeURIComponent(id)}/install`, { method: 'POST' })
    const index = state.skills.findIndex((s) => s.id === skill.id)
    if (index === -1) state.skills.push(skill)
    else state.skills[index] = { ...state.skills[index], ...skill }

    const project = activeProject()
    if (project && !(project.skillIds || []).includes(skill.id)) {
      const updated = await api(`/api/projects/${project.id}/skills`, {
        method: 'PUT',
        body: { skillIds: [...(project.skillIds || []), skill.id] },
      })
      project.skillIds = updated.skillIds || []
    }
    state.previewFactoryId = null
    openModal('modal-skills')
    renderSkillList()
    renderFactory()
    updateSkillsTrigger()
    toast(`${skill.name} installed and enabled`, 'ok')
  } catch (err) {
    install.disabled = false
    install.textContent = 'Retry'
    toast(err.message, 'error')
  }
}

async function toggleSkill(skillId) {
  const project = activeProject()
  if (!project) return
  const current = new Set(project.skillIds || [])
  if (current.has(skillId)) current.delete(skillId)
  else current.add(skillId)
  const next = [...current]
  try {
    const updated = await api(`/api/projects/${project.id}/skills`, {
      method: 'PUT',
      body: { skillIds: next },
    })
    project.skillIds = updated.skillIds || []
    renderSkillList()
    updateSkillsTrigger()
  } catch (err) {
    toast(err.message, 'error')
  }
}

function openSkillEditor(skill = null) {
  state.editingSkillId = skill?.id || null
  $('#skill-edit-title').textContent = skill ? 'Edit skill' : 'Add skill'
  $('#skill-icon').value = skill?.icon || ''
  $('#skill-name').value = skill?.name || ''
  $('#skill-description').value = skill?.description || ''
  $('#skill-tags').value = (skill?.tags || []).join(', ')
  $('#skill-brief').value = skill?.brief || ''
  $('#skill-delete').hidden = !skill || skill.builtin
  openModal('modal-skill-edit')
  setTimeout(() => $('#skill-name').focus(), 40)
}

async function saveSkillFromEditor(event) {
  event.preventDefault()
  const body = {
    icon: $('#skill-icon').value.trim() || '🧩',
    name: $('#skill-name').value.trim(),
    description: $('#skill-description').value.trim(),
    tags: $('#skill-tags').value,
    brief: $('#skill-brief').value.trim(),
  }
  if (!body.name) { toast('Give the skill a name', 'error'); return }
  if (!body.brief) { toast('Write the instructions the agent should follow', 'error'); return }
  try {
    const saved = state.editingSkillId
      ? await api(`/api/skills/${state.editingSkillId}`, { method: 'PUT', body })
      : await api('/api/skills', { method: 'POST', body })
    const index = state.skills.findIndex((s) => s.id === saved.id)
    if (index === -1) state.skills.push({ ...saved })
    else state.skills[index] = { ...state.skills[index], ...saved }
    toast(state.editingSkillId ? 'Skill updated' : 'Skill added', 'ok')
    state.editingSkillId = null
    openModal('modal-skills')
    renderSkillList()
  } catch (err) {
    toast(err.message, 'error')
  }
}

function confirmDeleteSkill(skill) {
  openConfirm(
    `Delete "${skill.name}"?`,
    'This removes the skill from your library. Projects that had it enabled will simply stop using it.',
    async () => {
      try {
        await api(`/api/skills/${skill.id}`, { method: 'DELETE' })
        state.skills = state.skills.filter((s) => s.id !== skill.id)
        // Drop it from the active project so the count stays honest.
        const project = activeProject()
        if (project?.skillIds?.includes(skill.id)) {
          const next = project.skillIds.filter((id) => id !== skill.id)
          const updated = await api(`/api/projects/${project.id}/skills`, {
            method: 'PUT', body: { skillIds: next },
          })
          project.skillIds = updated.skillIds || []
          updateSkillsTrigger()
        }
        toast(`Deleted ${skill.name}`, 'ok')
        openModal('modal-skills')
        renderSkillList()
      } catch (err) {
        toast(err.message, 'error')
      }
    },
  )
}

/* ------------------------------- templates ------------------------------ */

function renderTemplateChoices() {
  const select = $('#modal-new-template')
  if (!select) return
  select.replaceChildren()
  const list = state.templates.length
    ? state.templates
    : [{ id: 'react-vite', label: 'React + Vite + Tailwind' }]
  for (const t of list) select.append(el('option', { value: t.id, text: t.label, title: t.hint }))
  
  // Show color scheme step when template is selected
  select.addEventListener('change', () => {
    $('#color-scheme-step').hidden = !select.value
  })
}

/* ----------------------------- image attach ----------------------------- */

function addImageFiles(fileList) {
  for (const file of fileList) {
    if (!file.type.startsWith('image/')) continue
    if (state.pendingImages.length >= 8) break
    const reader = new FileReader()
    reader.onload = () => {
      state.pendingImages.push({ name: file.name, dataUrl: reader.result })
      renderImageThumbs()
    }
    reader.readAsDataURL(file)
  }
}

function renderImageThumbs() {
  const box = $('#chat-images')
  box.hidden = state.pendingImages.length === 0
  box.replaceChildren()
  state.pendingImages.forEach((img, index) => {
    box.append(el('div', { class: 'chat-thumb', title: img.name },
      el('img', { src: img.dataUrl, alt: img.name }),
      el('button', {
        type: 'button',
        title: 'Remove image',
        onclick: () => { state.pendingImages.splice(index, 1); renderImageThumbs() },
      }, '×'),
    ))
  })
}

function clearImages() {
  state.pendingImages = []
  const input = $('#chat-file')
  if (input) input.value = ''
  renderImageThumbs()
}

/* --------------------------- review before commit ------------------------ */

function showReviewBar(files) {
  const bar = $('#review-bar')
  bar.hidden = false
  $('#review-files').textContent = (files || []).slice(0, 6).join(', ')
    + ((files || []).length > 6 ? ` +${files.length - 6} more` : '')
}

function hideReviewBar() {
  $('#review-bar').hidden = true
}

async function approveReview() {
  const project = activeProject()
  if (!project) return
  try {
    const result = await api(`/api/projects/${project.id}/commit`, {
      method: 'POST',
      body: { message: 'Approved changes' },
    })
    hideReviewBar()
    toast(result.committed ? `Committed ${result.hash}` : 'Nothing to commit', 'ok')
    refreshWorkspace(project)
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function revertReview() {
  const project = activeProject()
  if (!project) return
  openConfirm(
    'Discard these changes?',
    'This reverts the working tree to the last commit, deleting the changes from this turn. This cannot be undone.',
    async () => {
      try {
        await api(`/api/projects/${project.id}/revert`, { method: 'POST' })
        hideReviewBar()
        toast('Changes reverted', 'ok')
        await refreshWorkspace(project)
        reloadPreview()
      } catch (err) {
        toast(err.message, 'error')
      }
    },
  )
}

/* -------------------------------- typecheck ------------------------------ */

async function runTypecheck() {
  const project = activeProject()
  if (!project) return
  switchView('logs')
  toast('Running typecheck…')
  try {
    const result = await api(`/api/projects/${project.id}/typecheck`, { method: 'POST' })
    toast(result.ok ? 'Typecheck passed' : 'Typecheck reported errors', result.ok ? 'ok' : 'error')
  } catch (err) {
    toast(err.message, 'error')
  }
}

/* --------------------------------- export -------------------------------- */

function exportProject() {
  const project = activeProject()
  if (!project) return
  const link = el('a', { href: `/api/projects/${project.id}/export`, download: `${project.slug}.zip` })
  document.body.append(link)
  link.click()
  link.remove()
  toast(`Downloading ${project.slug}.zip`)
}

/* ------------------------------ code search ------------------------------ */

function clearSearchResults() {
  const box = $('#search-results')
  box.hidden = true
  box.replaceChildren()
}

function renderSearchResults(hits) {
  const box = $('#search-results')
  box.replaceChildren()
  if (!hits.length) {
    box.hidden = false
    box.append(el('div', { class: 'empty-note' }, 'No matches'))
    return
  }
  box.hidden = false
  for (const hit of hits) {
    box.append(el('button', {
      class: 'search-hit',
      onclick: () => openFileAt(hit.path, hit.line),
    },
      el('span', { class: 'sh-loc', text: `${hit.path}:${hit.line}` }),
      el('span', { class: 'sh-text', text: hit.text }),
    ))
  }
}

async function runCodeSearch(pattern) {
  const project = activeProject()
  if (!project) return
  if (!pattern.trim()) { clearSearchResults(); return }
  try {
    const data = await api(`/api/projects/${project.id}/search?pattern=${encodeURIComponent(pattern)}`)
    renderSearchResults(data.hits || [])
  } catch (err) {
    renderSearchResults([])
    toast(err.message, 'error')
  }
}

async function openFileAt(filePath, line) {
  await openFile(filePath)
  if (!line) return
  const editor = $('#editor')
  if (editor.disabled) return
  const lines = editor.value.split('\n')
  const start = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0)
  const end = start + (lines[line - 1]?.length || 0)
  editor.focus()
  editor.setSelectionRange(start, end)
  editor.scrollTop = Math.max(0, (line - 5) * 20)
}

/* --------------------------------- restore ------------------------------- */

function restoreCommit() {
  const project = activeProject()
  const ref = state.selectedCommit
  if (!project || !ref) return
  openConfirm(
    `Restore working tree to ${ref}?`,
    'Files in the working tree are replaced with their content at this commit. Uncommitted changes are lost. The commit history is not rewritten.',
    async () => {
      try {
        await api(`/api/projects/${project.id}/restore`, { method: 'POST', body: { ref } })
        toast(`Restored to ${ref}`, 'ok')
        await refreshWorkspace(project)
        reloadPreview()
      } catch (err) {
        toast(err.message, 'error')
      }
    },
  )
}

/* --------------------------------- import -------------------------------- */

function openImport() {
  $('#modal-import-dir').value = ''
  $('#modal-import-name').value = ''
  openModal('modal-import')
  setTimeout(() => $('#modal-import-dir').focus(), 40)
}

async function doImport() {
  const dir = $('#modal-import-dir').value.trim()
  if (!dir) { toast('Enter a folder path', 'error'); return }
  try {
    const project = await api('/api/projects/import', {
      method: 'POST',
      body: { dir, name: $('#modal-import-name').value.trim() },
    })
    closeModal()
    await refreshProjects()
    await selectProject(project.id)
    toast(`Imported ${project.slug}`, 'ok')
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function refreshWorkspace(project) {
  const target = project || activeProject()
  if (!target) return
  const [status, tree, git] = await Promise.all([
    api(`/api/projects/${target.id}/status`).catch(() => null),
    api(`/api/projects/${target.id}/tree`).catch(() => null),
    api(`/api/projects/${target.id}/git`).catch(() => null),
  ])

  if (status) {
    target.status = status.status
    target.lastError = status.lastError
    setAgentRunning(Boolean(status.agentRunning))
    if (status.server?.logs?.length) {
      state.logs = status.server.logs
      renderLogs()
    }
    renderSidebar()
    renderTopbar()
    updatePreviewState()
  }
  if (tree) renderFileTree(tree.tree)
  applyGitSummary(git)
  if (git?.status?.length) loadDiff(null)
}

function switchView(view) {
  state.view = view
  for (const tab of $$('#tabs .tab')) tab.classList.toggle('active', tab.dataset.view === view)
  updateSlider($('#tabs'))
  for (const pane of $$('.view')) pane.hidden = pane.id !== `view-${view}`
  if (view === 'preview') {
    updatePreviewState()
    updateSlider($('.device-widths'))
  }
  if (view === 'code') {
    const project = activeProject()
    if (project) api(`/api/projects/${project.id}/tree`).then((d) => renderFileTree(d.tree)).catch(() => {})
  }
  if (view === 'history') {
    const project = activeProject()
    if (project) api(`/api/projects/${project.id}/git`).then((g) => {
      applyGitSummary(g)
      loadDiff(state.selectedCommit)
    }).catch(() => {})
  }
  if (view === 'logs') renderLogs()
}

/* -------------------------------- preview ------------------------------- */

function updatePreviewState() {
  const project = activeProject()
  if (!project) return
  const frame = $('#preview-frame')
  const url = project.previewUrl

  if (project.status === 'running' && url) {
    if (frame.dataset.src !== url) {
      frame.dataset.src = url
      frame.src = url
    }
    hidePreviewOverlay()
  } else if (project.status === 'error') {
    setPreviewOverlay(`Build error:\n${project.lastError || 'The dev server reported a problem.'}\n\nCheck the Logs tab for detail.`, true)
  } else {
    setPreviewOverlay(`Dev server ${project.status || 'stopped'}.\nUse Restart to bring it back up.`)
  }
}

function setPreviewOverlay(text, isError = false) {
  const overlay = $('#preview-overlay')
  overlay.hidden = false
  overlay.innerHTML = ''
  overlay.append(el('div', { class: 'preview-overlay-inner' },
    isError
      ? el('div', { class: 'dot error', style: 'width:12px;height:12px' })
      : el('div', { class: 'spinner' }),
    el('p', { id: 'preview-overlay-text', text }),
  ))
}

function hidePreviewOverlay() {
  $('#preview-overlay').hidden = true
}

function reloadPreview() {
  const frame = $('#preview-frame')
  if (frame.src) frame.src = frame.src
}

/* --------------------------- element selection --------------------------- */

function setSelectMode(on) {
  state.selecting = on
  const btn = $('#btn-select')
  if (btn) btn.classList.toggle('active', on)
  const stage = $('#preview-stage')
  if (stage) stage.classList.toggle('selecting', on)
  const frame = $('#preview-frame')
  try {
    frame?.contentWindow?.postMessage({ source: 'lovable-host', type: 'select-mode', enabled: on }, '*')
  } catch { /* frame not ready / cross-origin */ }
}

function describeElement(e) {
  const id = e.id ? ` id="${e.id}"` : ''
  const cls = e.classes ? ` class="${e.classes.split(/\s+/).slice(0, 3).join(' ')}"` : ''
  const text = e.text ? ` "${e.text.slice(0, 80)}"` : ''
  return `[Selected element in preview: <${e.tag}${id}${cls}>${text} — path: ${e.selector || e.tag}]`
}

function elementLabel(e) {
  let label = e.tag
  if (e.id) label += `#${e.id}`
  else if (e.classes) {
    const first = e.classes.split(/\s+/).filter(Boolean)[0]
    if (first) label += `.${first}`
  }
  return label
}

function renderElementRef() {
  const box = $('#element-ref')
  if (!box) return
  const e = state.selectedElement
  if (!e) { box.hidden = true; box.replaceChildren(); return }
  box.hidden = false
  const label = elementLabel(e)
  box.replaceChildren(
    el('span', { text: '🎯' }),
    el('span', { class: 'er-tag', text: label, title: e.text ? `${label} — "${e.text}"` : label }),
    el('button', {
      class: 'er-remove', type: 'button', title: 'Remove reference',
      onclick: () => { state.selectedElement = null; renderElementRef() },
    }, '×'),
  )
}

/* ------------------------------ suggestions ------------------------------ */

const SUGGESTION_HEAD = /^\s*(?:#{1,6}\s*)?(?:next steps?|suggestions?|follow.?ups?|you (?:can|could|might) also|would you like|what(?:'s| is) next|to do next|remaining (?:work|tasks?|items?)|i (?:can|could) also)\b/i
const SUGGESTION_BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/

/** Pull up to 4 follow-up suggestions out of a trailing list in the reply. */
function extractSuggestions(text) {
  if (!text) return []
  const lines = text.split('\n')
  const out = []
  let capturing = false
  for (const line of lines) {
    if (!capturing) {
      if (SUGGESTION_HEAD.test(line)) capturing = true
      continue
    }
    const m = line.match(SUGGESTION_BULLET)
    if (m) {
      const clean = m[1].replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
      if (clean) out.push(clean)
      if (out.length >= 4) break
    } else if (line.trim() === '') {
      if (out.length) break
    } else {
      break
    }
  }
  return out
}

function renderSuggestions(text) {
  const bar = $('#suggestion-bar')
  if (!bar) return
  const items = extractSuggestions(text)
  if (!items.length) { bar.hidden = true; bar.replaceChildren(); return }
  bar.hidden = false
  bar.replaceChildren(
    el('span', { class: 'sb-label', text: 'Suggested next steps' }),
    ...items.map((s) => el('button', {
      class: 'suggestion-pill', type: 'button', title: s,
      onclick: () => useSuggestion(s),
    }, '✨', s.length > 46 ? `${s.slice(0, 46)}…` : s)),
  )
}

function useSuggestion(text) {
  const input = $('#chat-input')
  if (!input || input.disabled) return
  input.value = text
  input.focus()
  const bar = $('#suggestion-bar')
  if (bar) { bar.hidden = true; bar.replaceChildren() }
}

function clearSuggestions() {
  const bar = $('#suggestion-bar')
  if (bar) { bar.hidden = true; bar.replaceChildren() }
}

/* Messages posted by src/preview-bridge.ts inside the generated app. */
window.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.source !== 'lovable-preview') return

  if (data.type === 'console') {
    pushConsole(data.level, data.text)
  } else if (data.type === 'runtime-error') {
    pushConsole('error', `${data.error?.message || 'Runtime error'}${data.error?.stack ? `\n${data.error.stack}` : ''}`)
  } else if (data.type === 'build-error') {
    pushConsole('error', `Build error: ${data.message}${data.file ? ` (${data.file})` : ''}`)
    const project = activeProject()
    if (project) {
      project.status = 'error'
      project.lastError = `${data.message}${data.file ? `\n${data.file}` : ''}`
      renderTopbar()
      updatePreviewState()
    }
  } else if (data.type === 'ready') {
    // The app booted cleanly inside the iframe; re-sync status in case the
    // server was still reporting a stale build error.
    const project = activeProject()
    if (project && project.status === 'error') refreshWorkspace(project)
  } else if (data.type === 'element-selected') {
    state.selectedElement = data.element || null
    setSelectMode(false)
    renderElementRef()
    if (state.selectedElement) $('#chat-input')?.focus()
  }
})

function pushConsole(level, text) {
  state.consoleLines.push({ level, text, at: Date.now() })
  if (state.consoleLines.length > 300) state.consoleLines.shift()

  const strip = $('#console-strip')
  strip.hidden = false
  const errors = state.consoleLines.filter((l) => l.level === 'error').length
  $('#console-count').textContent = String(errors || state.consoleLines.length)
  $('#console-body').append(el('div', { class: `console-line ${level}`, text: `[${level}] ${text}` }))
  $('#console-body').scrollTop = $('#console-body').scrollHeight
}

/* ---------------------------------- code -------------------------------- */

function renderFileTree(tree) {
  const root = $('#file-tree')
  root.replaceChildren()
  if (!tree?.length) {
    root.append(el('div', { class: 'empty-note' }, 'empty'))
    return
  }
  const renderNodes = (nodes, depth, parent) => {
    for (const node of nodes) {
      if (node.type === 'dir') {
        const childrenBox = el('div', { class: 'tree-children' })
        const toggle = el('button', {
          class: 'tree-node dir',
          style: `padding-left:${10 + depth * 12}px`,
          onclick: () => {
            const open = childrenBox.style.display !== 'none'
            childrenBox.style.display = open ? 'none' : 'block'
            toggle.querySelector('.tw').textContent = open ? '▸' : '▾'
          },
        }, el('span', { class: 'tw', text: '▾' }, ), node.name)
        parent.append(toggle, childrenBox)
        renderNodes(node.children || [], depth + 1, childrenBox)
      } else {
        parent.append(el('button', {
          class: `tree-node ${state.selectedFile === node.path ? 'active' : ''}`,
          style: `padding-left:${10 + depth * 12 + 15}px`,
          'data-path': node.path,
          onclick: () => openFile(node.path),
        }, el('span', { class: 'fi', text: fileIcon(node.name) }), node.name))
      }
    }
  }
  renderNodes(tree, 0, root)
}

async function openFile(filePath) {
  const project = activeProject()
  if (!project) return
  if (state.editorDirty && !window.confirm('Discard unsaved changes?')) return

  try {
    const data = await api(`/api/projects/${project.id}/file?path=${encodeURIComponent(filePath)}`)
    state.selectedFile = filePath
    state.editorDirty = false
    $('#editor-path').textContent = filePath
    $('#editor-dirty').hidden = true
    $('#btn-save').disabled = true

    const editor = $('#editor')
    if (data.binary) {
      editor.value = `(binary file, ${data.size} bytes)`
      editor.disabled = true
    } else if (data.truncated) {
      editor.value = `(file too large to edit here: ${data.size} bytes)`
      editor.disabled = true
    } else {
      editor.value = data.content
      editor.disabled = false
    }

    $$('#file-tree .tree-node').forEach((n) => n.classList.toggle('active', n.dataset.path === filePath))
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function saveFile() {
  const project = activeProject()
  if (!project || !state.selectedFile) return
  try {
    await api(`/api/projects/${project.id}/file`, {
      method: 'PUT',
      body: { path: state.selectedFile, content: $('#editor').value },
    })
    state.editorDirty = false
    $('#editor-dirty').hidden = true
    $('#btn-save').disabled = true
    toast(`Saved ${state.selectedFile}`, 'ok')
  } catch (err) {
    toast(err.message, 'error')
  }
}

/* -------------------------------- history ------------------------------- */

/** Feed a /git response into the History view, including the remote row. */
function applyGitSummary(git) {
  state.commits = git?.log || []
  state.remote = git?.available ? (git.remote || null) : null
  renderCommits()
  renderPushRow()
}

function renderPushRow() {
  const push = $('#btn-push')
  if (!push) return
  const label = $('#push-state')
  // Never paint a URL that could carry an embedded token.
  label.textContent = state.remote ? state.remote.replace(/\/\/[^@/]*@/, '//') : 'no remote'
  label.title = state.remote || 'The history stays on this machine until a remote is set.'
  $('#btn-set-remote').textContent = state.remote ? 'Edit remote' : 'Set remote'
  push.disabled = !state.remote
}

function openRemoteEditor() {
  const project = activeProject()
  if (!project) return
  openInput({
    title: 'Git remote',
    label: 'origin URL',
    value: state.remote || '',
    okLabel: 'Save remote',
    hint: 'https://, ssh://, file:// or git@… — a URL with an embedded token is stored in plain text in the project’s .git/config.',
    onOk: async (url) => {
      try {
        await api(`/api/projects/${project.id}/remote`, { method: 'PUT', body: { url: url.trim() } })
        toast('Remote saved', 'ok')
        applyGitSummary(await api(`/api/projects/${project.id}/git`).catch(() => null))
      } catch (err) {
        toast(err.message, 'error')
      }
    },
  })
}

async function pushProject() {
  const project = activeProject()
  if (!project) return
  const push = $('#btn-push')
  push.disabled = true
  push.textContent = 'Pushing…'
  try {
    await api(`/api/projects/${project.id}/push`, { method: 'POST' })
    toast(`Pushed ${project.slug} to origin`, 'ok')
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    push.textContent = 'Push'
    renderPushRow()
  }
}

function renderCommits() {
  const list = $('#commit-list')
  list.replaceChildren()
  const restoreBtn = $('#btn-restore')
  if (restoreBtn) restoreBtn.disabled = !state.selectedCommit
  if (!state.commits.length) {
    list.append(el('div', { class: 'empty-note' }, 'No commits yet'))
    return
  }
  for (const commit of state.commits) {
    list.append(el('button', {
      class: `commit-item ${state.selectedCommit === commit.hash ? 'active' : ''}`,
      onclick: () => {
        state.selectedCommit = commit.hash
        renderCommits()
        loadDiff(commit.hash)
      },
    },
      el('span', { class: 'ci-subject', text: commit.subject }),
      el('span', { class: 'ci-meta', text: `${commit.hash} · ${timeAgo(commit.timestamp)}` }),
    ))
  }
}

async function loadDiff(ref) {
  const project = activeProject()
  if (!project) return
  $('#diff-label').textContent = ref ? `Commit ${ref}` : 'Working tree changes'
  try {
    const data = await api(`/api/projects/${project.id}/diff${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`)
    renderDiff(data.diff || '')
  } catch (err) {
    $('#diff-view').textContent = err.message
  }
}

function renderDiff(diff) {
  const view = $('#diff-view')
  view.replaceChildren()
  if (!diff.trim()) {
    view.append(el('div', { class: 'empty-note' }, 'No changes'))
    return
  }
  for (const line of diff.split('\n')) {
    let cls = ''
    if (line.startsWith('+++') || line.startsWith('---')) cls = 'file'
    else if (line.startsWith('@@')) cls = 'hunk'
    else if (line.startsWith('+')) cls = 'add'
    else if (line.startsWith('-')) cls = 'del'
    view.append(el('span', { class: cls, text: `${line}\n` }))
  }
}

/* ---------------------------------- logs -------------------------------- */

function renderLogs() {
  const view = $('#log-view')
  view.replaceChildren()
  if (!state.logs.length) {
    view.append(el('div', { class: 'empty-note' }, 'No output yet. Start the dev server to see logs.'))
    return
  }
  for (const entry of state.logs) {
    view.append(el('span', { class: entry.stream === 'stdout' ? '' : entry.stream, text: `${entry.line}\n` }))
  }
  view.scrollTop = view.scrollHeight

  const errors = state.logs.filter((l) => l.stream === 'stderr').length
  const badge = $('#log-badge')
  badge.hidden = errors === 0
  badge.textContent = String(errors)
}

/* ---------------------------------- SSE --------------------------------- */

function connectEvents(project) {
  disconnectEvents()
  const source = new EventSource(`/api/projects/${project.id}/events`)
  state.events = source

  source.onmessage = (event) => {
    let data
    try { data = JSON.parse(event.data) } catch { return }
    handleEvent(data)
  }

  source.onerror = () => {
    // EventSource retries on its own; only rebuild if it gave up entirely.
    if (source.readyState === EventSource.CLOSED) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = setTimeout(() => {
        if (state.activeId === project.id) connectEvents(project)
      }, 2500)
    }
  }
}

function disconnectEvents() {
  clearTimeout(state.reconnectTimer)
  if (state.events) {
    state.events.close()
    state.events = null
  }
}

function handleEvent(data) {
  const project = activeProject()
  if (project && data.projectId && data.projectId !== project.id) {
    // Still update the sidebar so background projects show live status.
    if (data.type === 'status') {
      const other = state.projects.find((p) => p.id === data.projectId)
      if (other) { other.status = data.status; renderSidebar(); renderHome() }
    }
    return
  }

  switch (data.type) {
    case 'status':
      if (project) {
        project.status = data.status
        renderSidebar()
        renderHome()
        renderTopbar()
        updatePreviewState()
        if (data.status === 'running') hidePreviewOverlay()
        if (data.status === 'starting' || data.status === 'installing') {
          setPreviewOverlay(data.status === 'installing'
            ? 'Installing dependencies…\nThis happens once per project.'
            : 'Starting dev server…')
        }
      }
      break

    case 'log':
      state.logs.push({ stream: data.stream, line: data.line, at: data.at })
      if (state.logs.length > 400) state.logs.shift()
      if (state.view === 'logs') renderLogs()
      else {
        const badge = $('#log-badge')
        if (data.stream === 'stderr') {
          badge.hidden = false
          badge.textContent = String(Number(badge.textContent || 0) + 1)
        }
      }
      break

    case 'turn:queued':
      setAgentRunning(true)
      break

    case 'turn:start':
      setAgentRunning(true)
      clearSuggestions()
      state.currentAssistantEl = null
      state.currentAssistantText = ''
      state.currentThinkingEl = null
      state.currentThinkingText = ''
      state.thinkingStartedAt = 0
      break

    case 'assistant:thinking':
      appendThinkingDelta(data.delta)
      break

    case 'assistant:delta':
      finalizeThinking()
      appendAssistantDelta(data.delta)
      break

    case 'assistant:text':
      finalizeThinking()
      finalizeAssistant()
      break

    case 'tool:start':
      finalizeThinking()
      addToolEvent(data.id, data.name, 'running')
      break

    case 'tool:args':
      updateToolArgs(data.id, data.args)
      break

    case 'tool:log':
      appendToolLog(data.id, data.text)
      break

    case 'tool:end':
      addToolEvent(data.id, data.name, data.ok ? 'ok' : 'error', data.result)
      break

    case 'agent:selfheal':
      addChatMessage('system', `Build error detected — the agent is fixing it:\n${data.error.slice(0, 300)}`)
      break

    case 'agent:retry':
      addChatMessage('system', `Provider said "${data.message}" — retrying in ${Math.round(data.delayMs / 1000)}s (attempt ${data.attempt + 1}).`)
      break

    case 'system:notice':
      addChatMessage('system', data.message || '')
      break

    case 'git:commit':
      hideReviewBar()
      if (data.committed) toast(`Committed ${data.hash}`, 'ok')
      api(`/api/projects/${data.projectId}/git`).then(applyGitSummary).catch(() => {})
      break

    case 'review:pending':
      showReviewBar(data.files)
      break

    case 'typecheck:done':
      toast(data.ok ? 'Typecheck passed' : 'Typecheck reported errors', data.ok ? 'ok' : 'error')
      break

    case 'file:written':
      if (state.view === 'code') {
        api(`/api/projects/${data.projectId}/tree`).then((d) => renderFileTree(d.tree)).catch(() => {})
      }
      break

    case 'deps:changed':
      setTimeout(reloadPreview, 1500)
      break

    case 'steer:queued': {
      // The server echoes the message back so every connected tab sees it.
      const wrap = el('div', { class: 'msg user steering' },
        el('div', { class: 'msg-role' },
          document.createTextNode('you'),
          el('span', { class: 'steer-badge', text: 'steering…' }),
        ),
        el('div', { class: 'msg-bubble', text: data.text || '' }),
      )
      $('#chat-messages').append(wrap)
      if (data.queuedAt) state.steerNodes.set(data.queuedAt, wrap)
      scrollChat()
      break
    }

    case 'turn:steered': {
      const wrap = data.queuedAt ? state.steerNodes.get(data.queuedAt) : null
      if (wrap) {
        const badge = wrap.querySelector('.steer-badge')
        if (badge) {
          badge.textContent = `steered · step ${data.step}`
          badge.classList.add('delivered')
        }
        state.steerNodes.delete(data.queuedAt)
      } else {
        addChatMessage('user', data.text || '')
      }
      scrollChat()
      break
    }

    case 'steer:followup': {
      // The message missed the running turn and became its own turn instead.
      const wrap = data.queuedAt ? state.steerNodes.get(data.queuedAt) : null
      if (wrap) {
        const badge = wrap.querySelector('.steer-badge')
        if (badge) {
          badge.textContent = 'new turn'
          badge.classList.add('delivered')
        }
        state.steerNodes.delete(data.queuedAt)
      }
      break
    }

    case 'turn:end':
      setAgentRunning(false)
      removeWaiting()
      settleSteerBadges('not delivered')
      finalizeThinking()
      finalizeAssistant()
      renderSuggestions(state.lastAssistantText)
      if (data.usage?.inputTokens || data.usage?.outputTokens) {
        const steered = data.steered ? ` · ${data.steered} steered` : ''
        $('#usage-label').textContent = `${data.steps} steps${steered} · ${formatTokens(data.usage.inputTokens)}↑ ${formatTokens(data.usage.outputTokens)}↓`
        $('#usage-label').title = `${exactTokens(data.usage.inputTokens)} input / ${exactTokens(data.usage.outputTokens)} output tokens`
      }
      refreshWorkspace()
      break

    case 'turn:error':
      setAgentRunning(false)
      removeWaiting()
      settleSteerBadges('not delivered')
      finalizeThinking()
      finalizeAssistant()
      addChatMessage('error', `${data.message}${data.hint ? `\n\n${data.hint}` : ''}`)
      refreshWorkspace()
      break

    case 'turn:aborted':
      setAgentRunning(false)
      removeWaiting()
      settleSteerBadges('not delivered')
      finalizeThinking()
      finalizeAssistant()
      addChatMessage('system', 'Turn stopped.')
      refreshWorkspace()
      break

    case 'turn:maxsteps':
      addChatMessage('system', `Reached the ${data.maxSteps}-step limit. Send another message to continue.`)
      break

    case 'history:cleared':
      $('#chat-messages').replaceChildren()
      break

    default:
      break
  }
}

function setAgentRunning(running) {
  state.agentRunning = running
  $('#btn-abort').hidden = !running
  $('#btn-clear-chat').hidden = running
  // The composer stays live while the agent works: sending steers the turn.
  const send = $('#chat-send')
  send.disabled = !state.activeId
  send.classList.toggle('steer', running)
  send.textContent = running ? 'Steer' : 'Send'
  $('#chat-input').disabled = !state.activeId
  
  const project = activeProject()
  const usage = project?.usage || {}
  const contextUsed = ((usage.inputTokens || 0) + (usage.outputTokens || 0))
  const contextMax = 128000 // typical max context
  const contextPct = Math.min(100, Math.round((contextUsed / contextMax) * 100))
  
  // Context window as progress bar with percentage
  const contextEl = $('#context-window')
  if (state.activeId) {
    contextEl.innerHTML = `
      <span class="context-progress-bar">
        <span class="context-progress-fill" style="width: ${contextPct}%"></span>
      </span>
      <span>${contextPct}%</span>
      <div class="context-tooltip">
        <div class="context-tooltip-row">
          <span>Input tokens:</span>
          <span class="mono">${formatTokens(usage.inputTokens || 0)}</span>
        </div>
        <div class="context-tooltip-row">
          <span>Output tokens:</span>
          <span class="mono">${formatTokens(usage.outputTokens || 0)}</span>
        </div>
        <div class="context-tooltip-row">
          <span>Total used:</span>
          <span class="mono">${exactTokens(contextUsed)}</span>
        </div>
        <div class="context-tooltip-row">
          <span>Max capacity:</span>
          <span class="mono">${exactTokens(contextMax)}</span>
        </div>
        <button type="button" class="btn-compress-context">Compress context</button>
      </div>
    `
    
    // Add click handler for tooltip
    contextEl.onclick = (e) => {
      e.stopPropagation()
      contextEl.classList.toggle('active')
    }
    contextEl.querySelector('.btn-compress-context').addEventListener('click', (e) => {
      e.stopPropagation()
      contextEl.classList.remove('active')
      compressContext()
    })
  } else {
    contextEl.textContent = ''
  }
}

/**
 * Any steering badge still pending when a turn ends was never delivered.
 * Deferred, because the route emits `steer:followup` a tick after `turn:end`
 * when the message became its own turn instead.
 */
function settleSteerBadges(label) {
  if (!state.steerNodes.size) return
  setTimeout(() => {
    for (const [, wrap] of state.steerNodes) {
      const badge = wrap.querySelector('.steer-badge')
      if (badge && !badge.classList.contains('delivered')) {
        badge.textContent = label
        badge.classList.add('missed')
      }
    }
    state.steerNodes.clear()
  }, 600)
}

/* ---------------------------------- chat -------------------------------- */

function msgTimestamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function addChatMessage(role, text) {
  const wrap = el('div', { class: `msg ${role}` },
    el('div', { class: 'msg-role', text: role }),
    el('div', { class: 'msg-bubble' },
      document.createTextNode(text),
      el('span', { class: 'msg-time', text: msgTimestamp() }),
    ),
  )
  $('#chat-messages').append(wrap)
  scrollChat()
  return wrap
}

/** Bouncing-dots placeholder shown between sending and the first real output. */
function showWaiting() {
  removeWaiting()
  const wrap = el('div', { class: 'msg assistant waiting' },
    el('div', { class: 'msg-role', text: 'assistant' }),
    el('div', { class: 'msg-bubble waiting-bubble' }, el('i'), el('i'), el('i')),
  )
  $('#chat-messages').append(wrap)
  state.waitingEl = wrap
  scrollChat()
}

function removeWaiting() {
  if (state.waitingEl) {
    state.waitingEl.remove()
    state.waitingEl = null
  }
}

function appendAssistantDelta(delta) {
  removeWaiting()
  if (!state.currentAssistantEl) {
    state.currentAssistantEl = el('div', { class: 'msg assistant' },
      el('div', { class: 'msg-role', text: 'assistant' }),
      el('div', { class: 'msg-bubble' },
        el('span', { class: 'assistant-text' }),
        el('span', { class: 'msg-time', text: msgTimestamp() }),
      ),
    )
    $('#chat-messages').append(state.currentAssistantEl)
    state.currentAssistantText = ''
  }
  state.currentAssistantText += delta
  state.currentAssistantEl.querySelector('.assistant-text').textContent = state.currentAssistantText
  scrollChat()
}

function finalizeAssistant() {
  if (state.currentAssistantEl && !state.currentAssistantText.trim()) {
    state.currentAssistantEl.remove()
  }
  if (state.currentAssistantText.trim()) state.lastAssistantText = state.currentAssistantText
  state.currentAssistantEl = null
  state.currentAssistantText = ''
}

/**
 * Reasoning capture. The model streams `assistant:thinking` deltas; they land
 * in one collapsed "Thinking…" block per step. The block is finalized (label
 * switched to "Thought for Ns") as soon as real output — text, a tool call, or
 * the end of the turn — arrives, so thinking always sits above what it led to.
 */
function appendThinkingDelta(delta) {
  if (!delta) return
  removeWaiting()
  if (!state.currentThinkingEl) {
    state.thinkingStartedAt = Date.now()
    state.currentThinkingText = ''
    state.currentThinkingEl = renderThinkingBlock('', true)
    $('#chat-messages').append(state.currentThinkingEl)
  }
  state.currentThinkingText += delta
  state.currentThinkingEl.querySelector('.thinking-body').textContent = state.currentThinkingText
  scrollChat()
}

function finalizeThinking() {
  const node = state.currentThinkingEl
  if (!node) return
  const text = state.currentThinkingText
  if (!text.trim()) {
    node.remove()
  } else {
    const secs = Math.max(1, Math.round((Date.now() - state.thinkingStartedAt) / 1000))
    const label = node.querySelector('.thinking-label')
    if (label) label.textContent = `Thought for ${secs}s`
    node.classList.remove('thinking-live')
  }
  state.currentThinkingEl = null
  state.currentThinkingText = ''
  state.thinkingStartedAt = 0
}

/**
 * Build a collapsed reasoning block. `live` shows the animated "Thinking…"
 * affordance while deltas are still arriving; a persisted block is static and
 * always starts collapsed with a plain "Thinking" label.
 */
function renderThinkingBlock(text, live = false) {
  const body = el('div', { class: 'thinking-body', text })
  const label = el('span', { class: 'thinking-label', text: live ? 'Thinking…' : 'Thinking' })
  const head = el('button', {
    type: 'button',
    class: 'thinking-head',
    onclick: (event) => {
      event.stopPropagation()
      head.parentElement.classList.toggle('open')
    },
  },
    el('span', { class: 'th-arrow', text: '▸' }),
    label,
    live ? el('span', { class: 'th-dots' }, el('i'), el('i'), el('i')) : null,
  )
  const block = el('div', { class: `msg thinking ${live ? 'thinking-live' : ''}` },
    el('div', { class: 'thinking-card' }, head, body),
  )
  return block
}

function addToolEvent(id, name, status, result) {
  removeWaiting()
  let node = state.toolNodes.get(id)

  if (!node) {
    const body = el('div', { class: 'tool-body' })
    const head = el('button', {
      class: 'tool-head',
      onclick: () => node.event.classList.toggle('open'),
    },
      el('span', { class: `dot ${status === 'error' ? 'error' : status === 'ok' ? 'running' : 'busy'}` }),
      el('span', { class: 'tname', text: name }),
      el('span', { class: `tstatus ${status === 'ok' ? 'ok' : status === 'error' ? 'err' : 'run'}`, text: status }),
    )
    const container = el('div', { class: 'tool-event' }, head, body)
    node = { event: container, head, body, args: null }
    state.toolNodes.set(id, node)

    // Group consecutive tool calls under one heading to reduce noise.
    let group = $('#chat-messages').lastElementChild
    if (!group || !group.classList.contains('tool-group')) {
      group = el('div', { class: 'msg' },
        el('div', { class: 'msg-role', text: 'tools' }),
        el('div', { class: 'tool-group' }),
      )
      $('#chat-messages').append(group)
      group = group.lastElementChild
    } else {
      group = group.querySelector('.tool-group')
    }
    group.append(container)
  }

  const statusEl = node.head.querySelector('.tstatus')
  statusEl.textContent = status
  statusEl.className = `tstatus ${status === 'ok' ? 'ok' : status === 'error' ? 'err' : 'run'}`
  node.head.querySelector('.dot').className = `dot ${status === 'error' ? 'error' : status === 'ok' ? 'running' : 'busy'}`

  if (result !== undefined) {
    const argsText = node.args ? `arguments: ${JSON.stringify(node.args, null, 2)}\n\n` : ''
    node.body.textContent = `${argsText}${result}`
    if (status === 'error') node.event.classList.add('open')
  }
  scrollChat()
}

function updateToolArgs(id, args) {
  const node = state.toolNodes.get(id)
  if (!node) return
  node.args = args
  node.body.textContent = `arguments: ${JSON.stringify(args, null, 2)}`
}

function appendToolLog(id, text) {
  const node = state.toolNodes.get(id)
  if (!node) return
  node.body.textContent += text
}

function scrollChat() {
  const box = $('#chat-messages')
  box.scrollTop = box.scrollHeight
}

/** Compress context by summarizing earlier messages */
async function compressContext() {
  const project = activeProject()
  if (!project) return
  
  try {
    toast('Compressing context…')
    const result = await api(`/api/projects/${project.id}/compress`, { method: 'POST' })
    toast(`Context compressed: ${result.summary || 'done'}`, 'ok')
    
    // Reload history to reflect compression
    await loadChatHistory(project)
    
    // Update usage display
    const updated = await api(`/api/projects/${project.id}/status`)
    if (updated.usage) {
      project.usage = updated.usage
      setAgentRunning(state.agentRunning)
    }
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function loadChatHistory(project) {
  try {
    const data = await api(`/api/projects/${project.id}/history`)
    const box = $('#chat-messages')
    box.replaceChildren()
    state.steerNodes.clear()
    state.lastAssistantText = ''
    for (const message of data.messages || []) {
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === 'thinking' && block.thinking?.trim()) {
            box.append(renderThinkingBlock(block.thinking, false))
          } else if (block.type === 'text' && block.text?.trim()) {
            if (message.role !== 'user') state.lastAssistantText = block.text
            addChatMessage(message.role === 'user' ? 'user' : 'assistant', block.text)
          }
        }
      } else {
        const text = String(message.content || '')
        if (text.trim()) {
          if (message.role !== 'user') state.lastAssistantText = text
          addChatMessage(message.role === 'user' ? 'user' : 'assistant', text)
        }
      }
    }
    if (!data.messages?.length) {
      addChatMessage('system', `New project. Describe the app you want — the agent edits the real files in ${project.slug}/ and the preview updates live.`)
    }
    renderSuggestions(state.lastAssistantText)
    scrollChat()
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function sendMessage() {
  const project = activeProject()
  const input = $('#chat-input')
  const message = input.value.trim()
  if (!project || !message) return

  // Sending while the agent works steers the running turn instead of queueing a
  // second one, so the composer never has to be disabled mid-run.
  const steering = state.agentRunning

  input.value = ''
  const images = state.pendingImages.map((img) => img.dataUrl)
  clearImages()

  // Fold any picked preview element into the message the agent receives.
  let outgoing = message
  if (state.selectedElement) {
    outgoing = `${describeElement(state.selectedElement)}\n\n${message}`
    state.selectedElement = null
    renderElementRef()
  }
  clearSuggestions()

  if (!steering) {
    addChatMessage('user', message)
    state.toolNodes.clear()
    state.steerNodes.clear()
    setAgentRunning(true)
    showWaiting()
  }
  hideReviewBar()

  try {
    await api(`/api/projects/${project.id}/chat`, {
      method: 'POST',
      body: { message: outgoing, mode: state.mode, images },
    })
  } catch (err) {
    if (!steering) {
      setAgentRunning(false)
      removeWaiting()
    }
    if (err.payload?.needsKey) {
      addChatMessage('error', `${err.message}`)
      openSettings()
    } else {
      addChatMessage('error', steering ? `Could not steer the running turn: ${err.message}` : err.message)
    }
  } finally {
    input.focus()
  }
}

/* --------------------------------- modals ------------------------------- */

function openModal(id) {
  $('#modal-root').hidden = false
  $$('.modal').forEach((m) => { m.hidden = m.id !== id })
}

function closeModal() {
  $('#modal-root').hidden = true
}

function showModal(selector) {
  const modal = typeof selector === 'string' ? $(selector) : selector
  if (modal) openModal(modal.id)
}

function hideModal(selector) {
  const modal = typeof selector === 'string' ? $(selector) : selector
  if (modal) {
    modal.hidden = true
    // If this was the last modal, hide the root
    const visibleModals = $$('.modal').filter(m => !m.hidden)
    if (!visibleModals.length) closeModal()
  }
}

function escapeAttr(str) {
  if (!str) return ''
  return String(str).replace(/"/g, '&quot;')
}

/** Switch between settings tabs */
function switchSettingsTab(tabName) {
  // Update tab buttons
  $$('.settings-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName)
  })
  
  // Update panels
  $$('.settings-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${tabName}`)
  })
}

/** Reset personas to defaults */
function resetPersonas() {
  $('#settings-system-persona').value = DEFAULT_SYSTEM_PERSONA
  $('#settings-assistant-persona').value = DEFAULT_ASSISTANT_PERSONA
}

/**
 * Generic confirm dialog. Rebinds #confirm-ok to run `onOk` once, then close.
 * `options.checkbox` shows a tick box and passes its state to `onOk`.
 */
function openConfirm(title, body, onOk, options = {}) {
  $('#confirm-title').textContent = title
  $('#confirm-body').textContent = body

  const check = $('#confirm-check')
  const checkInput = $('#confirm-check-input')
  check.hidden = !options.checkbox
  if (options.checkbox) {
    $('#confirm-check-label').textContent = options.checkbox.label
    checkInput.checked = !!options.checkbox.checked
  }

  const ok = $('#confirm-ok')
  const replacement = ok.cloneNode(true)
  ok.replaceWith(replacement)
  replacement.addEventListener('click', async () => {
    try {
      await onOk(options.checkbox ? checkInput.checked : undefined)
    } finally {
      closeModal()
    }
  })

  openModal('modal-confirm')
}

/**
 * Generic one-field prompt modal. Rebinds #input-ok so it runs `onOk` with the
 * current value once, then closes. Enter in the field submits.
 */
function openInput({ title, label, value = '', hint = '', okLabel = 'Save', onOk }) {
  $('#input-title').textContent = title
  $('#input-label').textContent = label
  $('#input-hint').textContent = hint
  const field = $('#input-value')
  field.value = value

  const ok = $('#input-ok')
  const replacement = ok.cloneNode(true)
  ok.replaceWith(replacement)
  replacement.textContent = okLabel
  replacement.addEventListener('click', async () => {
    try {
      await onOk($('#input-value').value)
    } finally {
      closeModal()
    }
  })

  openModal('modal-input')
  field.focus()
  field.select()
}

function confirmRemoveProject(project) {
  const imported = project.template === 'imported'
  openConfirm(
    `Remove "${project.name}"?`,
    `The dev server stops and the project leaves the list; its chat history goes either way. `
      + `Files stay at ${project.path} unless you tick the box below.`
      + (imported ? ' This folder is one you imported, so ticking the box takes your own files with it.' : ''),
    async (deleteFiles) => {
      try {
        const result = await api(`/api/projects/${project.id}${deleteFiles ? '?files=1' : ''}`, { method: 'DELETE' })
        if (!deleteFiles) toast(`Removed ${project.slug} from the list`, 'ok')
        else if (result.filesDeleted) toast(`${project.slug} moved to the trash`, 'ok')
        else toast(`Removed ${project.slug}, but its folder is still at ${result.folderLeftAt}`, 'error')
        if (state.activeId === project.id) closeWorkspace()
        await refreshProjects()
      } catch (err) {
        toast(err.message, 'error')
      }
    },
    { checkbox: { label: 'Also move the project folder to the trash', checked: false } },
  )
}

async function createProject(name) {
  if (!name.trim()) return
  const template = $('#modal-new-template')?.value || undefined
  const colorScheme = document.querySelector('input[name="color-scheme"]:checked')?.value || 'neutral'
  
  try {
    const project = await api('/api/projects', { 
      method: 'POST', 
      body: { 
        name: name.trim(), 
        template,
        designId: colorScheme !== 'neutral' ? colorScheme : null,
      } 
    })
    closeModal()
    await refreshProjects()
    await selectProject(project.id)
    toast(`Created ${project.slug} on port ${project.port}`, 'ok')
  } catch (err) {
    toast(err.message, 'error')
  }
}

function renderSettingsProviderChoices() {
  const row = $('#settings-provider')
  row.replaceChildren()
  for (const provider of state.providers?.providers || ['pollinations', 'openai', 'anthropic', 'mock']) {
    const label = provider === 'mock'
      ? 'mock (scripted, no API)'
      : provider === 'pollinations'
        ? 'pollinations (OpenAI-compatible, default)'
        : provider
    row.append(el('label', {},
      el('input', {
        type: 'radio', name: 'provider', value: provider,
        ...(state.settings.provider === provider ? { checked: true } : {}),
      }),
      label,
    ))
  }

  const presetSelect = $('#settings-preset')
  presetSelect.replaceChildren()
  for (const preset of state.providers?.presets || []) {
    presetSelect.append(el('option', { value: preset.id, text: preset.label }))
  }
}

function renderImageSizeChoices() {
  const select = $('#settings-image-size')
  if (!select || select.options.length) return
  const sizes = state.providers?.imageSizes || [{ id: '1024x1024', label: 'Square · 1024×1024' }]
  select.replaceChildren()
  for (const size of sizes) {
    select.append(el('option', { value: size.id, text: size.label }))
  }
}

/** One-line status under the "Image model" heading. */
function renderImageState() {
  const label = $('#settings-image-state')
  if (!label) return
  const image = state.providers?.image
  if (image?.available) {
    label.textContent = `· active: ${image.model} @ ${image.host} (${image.source})`
    label.className = 'image-state ok'
  } else {
    label.textContent = '· not configured — the agent will fall back to the text endpoint'
    label.className = 'image-state muted'
  }
}

function openSettings() {
  const s = state.settings
  $('#settings-openai-key').value = ''
  $('#settings-openai-key').placeholder = s.openai.hasKey ? 'configured — leave blank to keep' : 'sk-…'
  $('#settings-openai-base').value = s.openai.baseUrl
  $('#settings-openai-model').value = s.openai.model

  $('#settings-anthropic-key').value = ''
  $('#settings-anthropic-key').placeholder = s.anthropic.hasKey ? 'configured — leave blank to keep' : 'sk-ant-…'
  $('#settings-anthropic-base').value = s.anthropic.baseUrl
  $('#settings-anthropic-model').value = s.anthropic.model

  const image = s.image || {}
  renderImageSizeChoices()
  $('#settings-image-key').value = ''
  $('#settings-image-key').placeholder = image.hasKey ? 'configured — leave blank to keep' : 'blank = reuse the text provider key'
  $('#settings-image-base').value = image.baseUrl || ''
  $('#settings-image-model').value = image.model || ''
  $('#settings-image-size').value = image.size || '1024x1024'
  $('#settings-image-result').hidden = true
  renderImageState()

  $('#settings-autoinstall').checked = s.agent.autoInstall !== false
  $('#settings-autocommit').checked = s.agent.autoCommit !== false
  $('#settings-reviewcommit').checked = s.agent.reviewCommit === true
  $('#settings-maxsteps').value = s.agent.maxSteps || 24
  $('#settings-maxsteps-val').textContent = String(s.agent.maxSteps || 24)
  $('#settings-test-result').hidden = true

  // Load personas
  const personas = s.personas || {}
  $('#settings-system-persona').value = personas.system || DEFAULT_SYSTEM_PERSONA
  $('#settings-assistant-persona').value = personas.assistant || DEFAULT_ASSISTANT_PERSONA

  $$('#settings-provider input').forEach((input) => {
    input.checked = input.value === s.provider
  })
  syncProviderVisibility()
  
  // Reset to first tab
  switchSettingsTab('general')
  
  openModal('modal-settings')
}

function syncProviderVisibility() {
  const chosen = $$('#settings-provider input').find((i) => i.checked)?.value || 'pollinations'
  // pollinations runs on the OpenAI-compatible adapter, so its endpoint fields
  // are the same block the presets fill.
  $('#settings-openai').hidden = !(chosen === 'openai' || chosen === 'pollinations')
  $('#settings-anthropic').hidden = chosen !== 'anthropic'
  return chosen
}

async function saveSettings() {
  const chosen = syncProviderVisibility()
  const patch = {
    provider: chosen,
    agent: {
      autoInstall: $('#settings-autoinstall').checked,
      autoCommit: $('#settings-autocommit').checked,
      reviewCommit: $('#settings-reviewcommit').checked,
      maxSteps: Number($('#settings-maxsteps').value),
    },
  }

  const openaiKey = $('#settings-openai-key').value.trim()
  const anthropicKey = $('#settings-anthropic-key').value.trim()
  const imageKey = $('#settings-image-key').value.trim()

  patch.openai = {
    baseUrl: $('#settings-openai-base').value.trim() || 'https://api.openai.com/v1',
    model: $('#settings-openai-model').value.trim() || 'gpt-4o',
  }
  if (openaiKey) patch.openai.apiKey = openaiKey

  patch.anthropic = {
    baseUrl: $('#settings-anthropic-base').value.trim() || 'https://api.anthropic.com',
    model: $('#settings-anthropic-model').value.trim() || 'claude-sonnet-4-5',
  }
  if (anthropicKey) patch.anthropic.apiKey = anthropicKey

  patch.image = {
    baseUrl: $('#settings-image-base').value.trim(),
    model: $('#settings-image-model').value.trim(),
    size: $('#settings-image-size').value || '1024x1024',
  }
  if (imageKey) patch.image.apiKey = imageKey

  try {
    state.settings = await api('/api/settings', { method: 'PUT', body: patch })
    $('#mock-banner').hidden = chosen !== 'mock'
    const health = await api('/api/health')
    state.health = health
    state.providers = await api('/api/providers').catch(() => state.providers)
    renderProviderPill(health)
    renderVersionChip(health)
    renderImageState()
    toast('Settings saved', 'ok')
    closeModal()
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function testConnection() {
  const box = $('#settings-test-result')
  const chosen = syncProviderVisibility()
  box.hidden = false
  box.className = 'test-result'
  box.textContent = 'Testing…'

  // Save first so the test uses whatever is currently in the form.
  try {
    await saveSettingsSilently(chosen)
  } catch { /* test anyway with stored values */ }

  try {
    const result = await api('/api/settings/test', { method: 'POST', body: { provider: chosen } })
    if (result.ok) {
      box.className = 'test-result ok'
      box.textContent = `Connected to ${result.provider} in ${result.latencyMs}ms\nmodel: ${result.model}\nreply: ${result.reply || '(empty)'}`
    } else {
      box.className = 'test-result bad'
      box.textContent = `Failed (${result.status || 'no status'})\n${result.error}${result.hint ? `\n\n${result.hint}` : ''}`
    }
  } catch (err) {
    box.className = 'test-result bad'
    box.textContent = err.message
  }
}

/** Persist the form without closing the modal or toasting. */
async function saveSettingsSilently(chosen) {
  const patch = { provider: chosen }
  const openaiKey = $('#settings-openai-key').value.trim()
  const anthropicKey = $('#settings-anthropic-key').value.trim()
  const imageKey = $('#settings-image-key').value.trim()
  patch.openai = {
    baseUrl: $('#settings-openai-base').value.trim(),
    model: $('#settings-openai-model').value.trim(),
  }
  if (openaiKey) patch.openai.apiKey = openaiKey
  patch.anthropic = {
    baseUrl: $('#settings-anthropic-base').value.trim(),
    model: $('#settings-anthropic-model').value.trim(),
  }
  if (anthropicKey) patch.anthropic.apiKey = anthropicKey
  patch.image = {
    baseUrl: $('#settings-image-base').value.trim(),
    model: $('#settings-image-model').value.trim(),
    size: $('#settings-image-size').value || '1024x1024',
  }
  if (imageKey) patch.image.apiKey = imageKey
  
  // Save personas
  const systemPersona = $('#settings-system-persona').value.trim()
  const assistantPersona = $('#settings-assistant-persona').value.trim()
  patch.personas = {
    system: systemPersona !== DEFAULT_SYSTEM_PERSONA ? systemPersona : undefined,
    assistant: assistantPersona !== DEFAULT_ASSISTANT_PERSONA ? assistantPersona : undefined,
  }
  
  state.settings = await api('/api/settings', { method: 'PUT', body: patch })
  state.providers = await api('/api/providers').catch(() => state.providers)
  renderImageState()
}

/** Generate a throwaway 256×256 image to prove the endpoint works. */
async function testImageModel() {
  const box = $('#settings-image-result')
  const chosen = syncProviderVisibility()
  box.hidden = false
  box.className = 'test-result'
  box.textContent = 'Generating a test image…'

  try {
    await saveSettingsSilently(chosen)
  } catch { /* test with whatever is stored */ }

  try {
    const result = await api('/api/settings/test-image', { method: 'POST', body: {} })
    if (result.ok) {
      box.className = 'test-result ok'
      box.textContent = `Image endpoint OK in ${result.latencyMs}ms\nmodel: ${result.model} (${result.source})\nreturned ${result.bytes} bytes of ${result.format}`
    } else {
      box.className = 'test-result bad'
      box.textContent = `Image generation failed\n${result.error}${result.hint ? `\n\n${result.hint}` : ''}`
    }
  } catch (err) {
    box.className = 'test-result bad'
    box.textContent = err.message
  }
}

/* ------------------------------ MCP management ---------------------------- */

let mcpServers = []
let catalogCache = null

async function loadMcpServers() {
  try {
    const res = await api('/api/mcp')
    mcpServers = res.servers || []
    renderMcpServerList()
  } catch (err) {
    console.warn('Failed to load MCP servers:', err)
  }
}

function renderMcpServerList() {
  const list = $('#mcp-server-list')
  if (!list) return
  
  if (!mcpServers.length) {
    list.innerHTML = '<p class="muted small">No MCP servers configured.</p>'
    return
  }
  
  list.innerHTML = mcpServers.map(srv => `
    <div class="mcp-server-card" data-id="${srv.id}">
      <span class="mcp-name" title="${escapeHtml(srv.name)}">${escapeHtml(srv.name)}</span>
      <span class="mcp-transport">${srv.transport}</span>
      <span class="mcp-status ${srv.running ? 'running' : ''}" title="${srv.running ? 'Running' : 'Stopped'}"></span>
      <div class="mcp-actions">
        <button class="btn btn-ghost btn-sm" onclick="toggleMcpServer('${srv.id}', ${!srv.running})" title="${srv.running ? 'Stop' : 'Start'}">
          ${srv.running ? '⏹' : '▶'}
        </button>
        <button class="btn btn-ghost btn-sm" onclick="editMcpServer('${srv.id}')" title="Edit">✎</button>
        <button class="btn btn-ghost btn-sm" onclick="deleteMcpServer('${srv.id}')" title="Delete">✕</button>
      </div>
      ${srv.error ? `<div class="mcp-error">${escapeHtml(srv.error)}</div>` : ''}
      ${srv.toolCount > 0 ? `<div style="grid-column:1/-1;font-size:11px;color:var(--green)">✓ ${srv.toolCount} tools available</div>` : ''}
    </div>
  `).join('')
}

async function toggleMcpServer(id, start) {
  try {
    const endpoint = start ? `/api/mcp/${id}/start` : `/api/mcp/${id}/stop`
    await api(endpoint, { method: 'POST' })
    await loadMcpServers()
  } catch (err) {
    toast(err.message, 'bad')
  }
}

async function deleteMcpServer(id) {
  if (!confirm(`Remove MCP server "${id}"?`)) return
  try {
    await api(`/api/mcp/${id}`, { method: 'DELETE' })
    await loadMcpServers()
    toast('Server removed', 'ok')
  } catch (err) {
    toast(err.message, 'bad')
  }
}

function editMcpServer(id) {
  // TODO: Open add modal pre-filled with server config
  toast('Edit functionality coming soon', 'ok')
}

async function loadMcpCatalog(search = '') {
  const list = $('#catalog-list')
  if (!list) return
  
  list.innerHTML = '<p class="muted small">Loading catalog…</p>'
  
  try {
    const url = search ? `/api/mcp/catalog?q=${encodeURIComponent(search)}` : '/api/mcp/catalog'
    const res = await api(url)
    catalogCache = res
    
    if (!res.servers || !res.servers.length) {
      list.innerHTML = '<p class="muted small">No servers found.</p>'
      return
    }
    
    renderCatalogList(res.servers)
  } catch (err) {
    list.innerHTML = `<p class="muted small" style="color:var(--red)">Failed to load catalog: ${escapeHtml(err.message)}</p>`
  }
}

function renderCatalogList(servers) {
  const list = $('#catalog-list')
  if (!list) return
  
  list.innerHTML = servers.map(srv => `
    <div class="catalog-card">
      <div class="catalog-header">
        <span class="catalog-name">${escapeHtml(srv.name)}</span>
        <button class="btn btn-primary btn-sm" onclick="installFromCatalog('${escapeAttr(srv.name)}')">Install</button>
      </div>
      <div class="catalog-desc">${escapeHtml(srv.description || 'No description')}</div>
      <div class="catalog-meta">
        <span>${srv.transportType || 'stdio'}</span>
        ${srv.version ? `<span>v${escapeHtml(srv.version)}</span>` : ''}
        ${srv.repository ? `<a href="${escapeAttr(srv.repository)}" target="_blank" rel="noopener">repo</a>` : ''}
      </div>
      ${srv.tags && srv.tags.length ? `
        <div class="catalog-tags" style="margin-top:6px">
          ${srv.tags.slice(0, 5).map(t => `<span class="catalog-tag">${escapeHtml(t)}</span>`).join('')}
        </div>
      ` : ''}
    </div>
  `).join('')
}

async function installFromCatalog(name) {
  try {
    const detail = await api(`/api/mcp/catalog/${encodeURIComponent(name)}`)
    if (!detail || !detail.configTemplate) {
      toast('Server configuration not available', 'bad')
      return
    }
    
    const config = {
      name: detail.name,
      ...detail.configTemplate,
      enabled: true,
    }
    
    await api('/api/mcp', { method: 'POST', body: config })
    await loadMcpServers()
    toast(`Installed ${detail.name}`, 'ok')
    
    // Close catalog modal
    hideModal('#modal-mcp-catalog')
  } catch (err) {
    toast(err.message, 'bad')
  }
}

function wireMcpEvents() {
  // Add server button
  $('#btn-add-mcp')?.addEventListener('click', () => {
    showModal('#modal-add-mcp')
  })
  
  // Browse catalog button
  $('#btn-browse-catalog')?.addEventListener('click', () => {
    showModal('#modal-mcp-catalog')
    loadMcpCatalog()
  })
  
  // Transport type toggle
  document.querySelectorAll('input[name="transport"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const isStdio = e.target.value === 'stdio'
      $('#mcp-stdio-fields').hidden = !isStdio
      $('#mcp-http-fields').hidden = isStdio
    })
  })
  
  // Add server form submission
  $('#form-add-mcp')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    
    const name = $('#mcp-name').value.trim()
    const transport = document.querySelector('input[name="transport"]:checked').value
    
    if (!name) {
      toast('Server name is required', 'bad')
      return
    }
    
    try {
      const config = { name, enabled: true }
      
      if (transport === 'stdio') {
        config.transport = 'stdio'
        config.command = $('#mcp-command').value
        const argsStr = $('#mcp-args').value.trim()
        config.args = argsStr ? argsStr.split(/\s+/) : []
      } else {
        config.transport = 'http'
        config.url = $('#mcp-url').value.trim()
        const headersStr = $('#mcp-headers').value.trim()
        if (headersStr) {
          try {
            config.headers = JSON.parse(headersStr)
          } catch {
            toast('Headers must be valid JSON', 'bad')
            return
          }
        }
      }
      
      await api('/api/mcp', { method: 'POST', body: config })
      await loadMcpServers()
      toast('Server added', 'ok')
      hideModal('#modal-add-mcp')
      e.target.reset()
    } catch (err) {
      toast(err.message, 'bad')
    }
  })
  
  // Refresh catalog button
  $('#btn-refresh-catalog')?.addEventListener('click', () => {
    const search = $('#catalog-search').value.trim()
    loadMcpCatalog(search)
  })
  
  // Catalog search with debounce
  let searchTimer
  $('#catalog-search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      loadMcpCatalog(e.target.value.trim())
    }, 300)
  })
}

/* ------------------------------- connectors ------------------------------ */

const CONNECTOR_STORE = 'lovable-connectors'

function connectorStates() {
  try { return JSON.parse(localStorage.getItem(CONNECTOR_STORE)) || {} } catch { return {} }
}

function renderConnectorStates() {
  const saved = connectorStates()
  for (const btn of $$('.connector-toggle')) {
    const connected = Boolean(saved[btn.dataset.connector])
    btn.classList.toggle('connected', connected)
    btn.textContent = connected ? 'Connected' : 'Connect'
  }
}

function wireConnectorEvents() {
  $$('.connector-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.connector
      const saved = connectorStates()
      const connect = !saved[id]
      if (connect) saved[id] = true
      else delete saved[id]
      try { localStorage.setItem(CONNECTOR_STORE, JSON.stringify(saved)) } catch { /* private mode */ }
      btn.classList.toggle('connected', connect)
      btn.textContent = connect ? 'Connected' : 'Connect'
      const name = btn.closest('.connector-card')?.querySelector('strong')?.textContent || id
      toast(connect ? `${name} connector enabled` : `${name} connector disabled`, connect ? 'ok' : '')
    })
  })

  $('#connector-search')?.addEventListener('input', (event) => {
    const q = event.target.value.trim().toLowerCase()
    for (const card of $$('.connector-card')) {
      const text = card.textContent.toLowerCase()
      card.hidden = Boolean(q) && !text.includes(q)
    }
    for (const group of $$('.category-group')) {
      const visible = [...group.querySelectorAll('.connector-card')].some((c) => !c.hidden)
      group.hidden = !visible
    }
  })

  renderConnectorStates()
}

/* ------------------------------ global wiring --------------------------- */

function wireGlobalEvents() {
  $('#new-project').addEventListener('click', () => {
    $('#modal-new-name').value = ''
    openModal('modal-new')
    setTimeout(() => $('#modal-new-name').focus(), 40)
  })

  $('#modal-new-form').addEventListener('submit', (event) => {
    event.preventDefault()
    createProject($('#modal-new-name').value)
  })

  $('#home-create').addEventListener('submit', (event) => {
    event.preventDefault()
    const input = $('#home-name')
    createProject(input.value)
    input.value = ''
  })

  $('#home-name').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      createProject(event.target.value)
      event.target.value = ''
    }
  })

  $$('#modal-root [data-close]').forEach((node) => node.addEventListener('click', closeModal))
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#modal-root').hidden) closeModal()
  })

  $('#open-settings').addEventListener('click', openSettings)
  $('#provider-pill').addEventListener('click', openSettings)
  $('#theme-toggle').addEventListener('click', toggleTheme)

  $('#btn-connectors')?.addEventListener('click', () => openModal('modal-connectors'))
  
  // Close context tooltip when clicking outside
  document.addEventListener('click', (e) => {
    const contextEl = $('#context-window')
    if (contextEl && !contextEl.contains(e.target)) {
      contextEl.classList.remove('active')
    }
  })
  
  $('#btn-skills').addEventListener('click', openSkills)
  const skillSearch = $('#skill-search')
  skillSearch.addEventListener('input', (event) => {
    state.skillFilter = event.target.value
    renderSkillList()
    renderFactory()
    loadFactory()
  })
  // Focusing the search field opens the factory: your skills first, then the
  // downloadable catalog.
  skillSearch.addEventListener('focus', () => {
    renderFactory()
    loadFactory()
  })
  $('#skill-preview-install').addEventListener('click', installPreviewedSkill)
  $('#skill-preview-cancel').addEventListener('click', () => {
    state.previewFactoryId = null
    openModal('modal-skills')
  })
  $('#btn-add-skill').addEventListener('click', () => openSkillEditor())
  $('#skill-edit-form').addEventListener('submit', saveSkillFromEditor)
  $('#skill-edit-cancel').addEventListener('click', () => {
    state.editingSkillId = null
    openModal('modal-skills')
  })
  $('#skill-delete').addEventListener('click', () => {
    const skill = state.skills.find((s) => s.id === state.editingSkillId)
    if (skill) confirmDeleteSkill(skill)
  })

  $('#settings-save').addEventListener('click', saveSettings)
  $('#settings-test').addEventListener('click', testConnection)
  $('#settings-test-image').addEventListener('click', testImageModel)
  
  // Settings tab switching
  $$('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => switchSettingsTab(tab.dataset.tab))
  })
  
  // Persona reset button
  $('#btn-reset-personas')?.addEventListener('click', resetPersonas)
  
  $('#open-about').addEventListener('click', async () => {
    // Refresh so the About panel reflects the running build, not a stale boot.
    try {
      state.health = await api('/api/health')
      renderVersionChip(state.health)
    } catch { /* show what we have */ }
    openAbout()
  })
  $('#settings-maxsteps').addEventListener('input', (e) => {
    $('#settings-maxsteps-val').textContent = e.target.value
  })
  $('#settings-preset').addEventListener('change', (event) => {
    const preset = (state.providers?.presets || []).find((p) => p.id === event.target.value)
    if (!preset) return
    if (preset.baseUrl) $('#settings-openai-base').value = preset.baseUrl
    if (preset.model) $('#settings-openai-model').value = preset.model
  })
  $$('#settings-provider input').forEach((input) => {
    input.addEventListener('change', syncProviderVisibility)
  })

  $('#tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab')
    if (tab) switchView(tab.dataset.view)
  })

  $('#btn-reload').addEventListener('click', reloadPreview)
  $('#btn-select').addEventListener('click', () => {
    if (!activeProject()) { toast('Select a project first'); return }
    setSelectMode(!state.selecting)
    if (state.selecting) toast('Click an element in the preview to reference it in chat')
  })
  $('#btn-restart').addEventListener('click', async () => {
    const project = activeProject()
    if (!project) return
    setPreviewOverlay('Restarting dev server…')
    try {
      await api(`/api/projects/${project.id}/restart`, { method: 'POST' })
      await refreshWorkspace(project)
      reloadPreview()
    } catch (err) {
      toast(err.message, 'error')
    }
  })
  $('#btn-stop').addEventListener('click', async () => {
    const project = activeProject()
    if (!project) return
    try {
      await api(`/api/projects/${project.id}/stop`, { method: 'POST' })
      await refreshWorkspace(project)
    } catch (err) {
      toast(err.message, 'error')
    }
  })

  $$('.device-widths .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('.device-widths .chip').forEach((c) => c.classList.remove('active'))
      chip.classList.add('active')
      updateSlider(chip.parentElement)
      const width = Number(chip.dataset.width)
      $('#preview-frame').style.width = width ? `${width}px` : '100%'
    })
  })

  $('#console-toggle').addEventListener('click', () => $('#console-strip').classList.toggle('open'))
  $('#btn-clear-logs').addEventListener('click', () => {
    state.logs = []
    $('#log-badge').hidden = true
    renderLogs()
  })
  $('#btn-refresh-tree').addEventListener('click', async () => {
    const project = activeProject()
    if (!project) return
    const data = await api(`/api/projects/${project.id}/tree`)
    renderFileTree(data.tree)
  })
  $('#btn-diff-worktree').addEventListener('click', () => {
    state.selectedCommit = null
    renderCommits()
    loadDiff(null)
  })

  $('#btn-save').addEventListener('click', saveFile)
  $('#editor').addEventListener('input', () => {
    state.editorDirty = true
    $('#editor-dirty').hidden = false
    $('#btn-save').disabled = false
  })
  $('#editor').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault()
      saveFile()
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const box = event.target
      const start = box.selectionStart
      box.value = `${box.value.slice(0, start)}  ${box.value.slice(box.selectionEnd)}`
      box.selectionStart = box.selectionEnd = start + 2
      box.dispatchEvent(new Event('input'))
    }
  })

  // Strategy toggle (Build / Plan) inside the composer
  $$('.strategy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.strategy
      $$('.strategy-btn').forEach((b) => b.classList.toggle('active', b === btn))
      updateSlider(btn.parentElement)
      $('#chat-input').placeholder = state.mode === 'plan'
        ? 'Discuss the approach — no files are changed in Plan mode…'
        : 'Describe what to build or change…'
    })
  })

  $('#chat-form').addEventListener('submit', (event) => {
    event.preventDefault()
    sendMessage()
  })

  $('#chat-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  })
  
  $('#btn-abort').addEventListener('click', async () => {
    const project = activeProject()
    if (!project) return
    try {
      await api(`/api/projects/${project.id}/abort`, { method: 'POST' })
      toast('Stopping…')
    } catch (err) {
      toast(err.message, 'error')
    }
  })

  $('#btn-clear-chat').addEventListener('click', async () => {
    const project = activeProject()
    if (!project) return
    try {
      await api(`/api/projects/${project.id}/history`, { method: 'DELETE' })
      $('#chat-messages').replaceChildren()
      addChatMessage('system', 'Conversation cleared. The code and git history are untouched.')
    } catch (err) {
      toast(err.message, 'error')
    }
  })

  // --- images / review / search / typecheck / export / import / restore ---

  const attachBtn = $('#btn-attach')
  const chatFile = $('#chat-file')
  if (attachBtn && chatFile) {
    attachBtn.addEventListener('click', () => chatFile.click())
    chatFile.addEventListener('change', (event) => {
      addImageFiles(event.target.files)
      event.target.value = ''
    })
  }

  const chatPane = $('#chat')
  if (chatPane) {
    chatPane.addEventListener('dragover', (event) => {
      event.preventDefault()
      chatPane.classList.add('dragging')
    })
    chatPane.addEventListener('dragleave', () => chatPane.classList.remove('dragging'))
    chatPane.addEventListener('drop', (event) => {
      event.preventDefault()
      chatPane.classList.remove('dragging')
      if (event.dataTransfer?.files?.length) addImageFiles(event.dataTransfer.files)
    })
  }

  $('#review-approve')?.addEventListener('click', approveReview)
  $('#review-revert')?.addEventListener('click', revertReview)
  $('#review-diff')?.addEventListener('click', () => {
    state.selectedCommit = null
    switchView('history')
    renderCommits()
    loadDiff(null)
  })

  $('#btn-typecheck')?.addEventListener('click', runTypecheck)
  $('#btn-export-code')?.addEventListener('click', exportProject)
  $('#btn-remove-project')?.addEventListener('click', () => {
    const project = activeProject()
    if (project) confirmRemoveProject(project)
  })
  $('#btn-all-projects')?.addEventListener('click', closeWorkspace)
  $('#btn-diagnostics')?.addEventListener('click', downloadDiagnostics)
  $('#btn-set-remote')?.addEventListener('click', openRemoteEditor)
  $('#btn-push')?.addEventListener('click', pushProject)

  $('#input-value')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      $('#input-ok').click()
    }
  })
  $('#btn-restore')?.addEventListener('click', restoreCommit)
  $('#import-project')?.addEventListener('click', openImport)
  $('#modal-import-ok')?.addEventListener('click', doImport)

  const codeSearch = $('#code-search')
  if (codeSearch) {
    codeSearch.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        clearTimeout(state.searchTimer)
        runCodeSearch(codeSearch.value)
      }
      if (event.key === 'Escape') {
        codeSearch.value = ''
        clearSearchResults()
      }
    })
    codeSearch.addEventListener('input', () => {
      clearTimeout(state.searchTimer)
      const value = codeSearch.value
      if (!value.trim()) { clearSearchResults(); return }
      state.searchTimer = setTimeout(() => runCodeSearch(value), 350)
    })
  }

  // Sliding pill indicators for the tab-button groups
  for (const group of ['#tabs', '.device-widths', '.strategy-toggle']) initSlider($(group))
  window.addEventListener('resize', () => {
    updateSlider($('#tabs'))
    updateSlider($('.device-widths'))
    updateSlider($('.strategy-toggle'))
  })

  // Poll so status stays honest even if an SSE reconnect is missed.
  setInterval(() => {
    if (document.hidden) return
    api('/api/projects').then((data) => {
      const previous = new Map(state.projects.map((p) => [p.id, p]))
      state.projects = data.projects.map((p) => ({ ...p, status: previous.get(p.id)?.status || p.status }))
      renderSidebar()
      renderHome()
      if (state.activeId) renderTopbar()
    }).catch(() => {})
  }, 12_000)
}

initTheme()
boot()
