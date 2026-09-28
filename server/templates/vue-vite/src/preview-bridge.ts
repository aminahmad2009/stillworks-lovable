/**
 * Preview bridge. Reports console errors, unhandled rejections and runtime
 * exceptions to the parent frame so the platform can show them and hand them
 * to the agent. Inert when the app is opened outside an iframe.
 */
const inFrame = typeof window !== 'undefined' && window.parent !== window

function post(type, payload) {
  if (!inFrame) return
  try {
    window.parent.postMessage({ source: 'lovable-preview', type, ...payload }, '*')
  } catch {
    /* parent gone */
  }
}

function serializeError(error) {
  if (!error) return { message: 'Unknown error' }
  if (typeof error === 'string') return { message: error }
  return {
    message: error.message || String(error),
    stack: typeof error.stack === 'string' ? error.stack.slice(0, 3000) : undefined,
    name: error.name,
  }
}

if (inFrame && typeof window !== 'undefined') {
  const originalError = console.error
  const originalWarn = console.warn
  const originalLog = console.log

  console.error = (...args) => {
    originalError.apply(console, args)
    post('console', { level: 'error', text: args.map(format).join(' ').slice(0, 2000) })
  }
  console.warn = (...args) => {
    originalWarn.apply(console, args)
    post('console', { level: 'warn', text: args.map(format).join(' ').slice(0, 2000) })
  }
  console.log = (...args) => {
    originalLog.apply(console, args)
    post('console', { level: 'log', text: args.map(format).join(' ').slice(0, 2000) })
  }

  window.addEventListener('error', (event) => {
    post('runtime-error', {
      error: serializeError(event.error || event.message),
      file: event.filename,
      line: event.lineno,
      column: event.colno,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    post('runtime-error', { error: serializeError(event.reason), unhandledRejection: true })
  })

  // Vite's own error overlay signals a compile failure; surface it as text too.
  const observer = new MutationObserver(() => {
    const overlay = document.querySelector('vite-error-overlay')
    if (!overlay) return
    const message = overlay.shadowRoot?.querySelector('.message')?.textContent
    const file = overlay.shadowRoot?.querySelector('.file')?.textContent
    if (message) post('build-error', { message: message.trim(), file: file?.trim() })
  })

  const start = () => observer.observe(document.documentElement, { childList: true, subtree: true })
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }

  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'lovable-host') return
    if (event.data.type === 'ping') {
      post('pong', { href: window.location.href, title: document.title })
    } else if (event.data.type === 'select-mode') {
      setSelectMode(Boolean(event.data.enabled))
    }
  })

  /* --------------------------- element picking --------------------------- */

  let highlight: HTMLElement | null = null

  function cssPath(node: Element): string {
    const parts: string[] = []
    let cur: Element | null = node
    let depth = 0
    while (cur && cur.nodeType === 1 && depth < 5) {
      let seg = cur.tagName.toLowerCase()
      if (cur.id) {
        parts.unshift(`${seg}#${cur.id}`)
        break
      }
      const cls = typeof cur.className === 'string' ? cur.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
      if (cls) seg += `.${cls}`
      parts.unshift(seg)
      cur = cur.parentElement
      depth++
    }
    return parts.join(' > ')
  }

  function describe(node: Element) {
    return {
      tag: node.tagName.toLowerCase(),
      id: node.id || '',
      classes: typeof node.className === 'string' ? node.className.trim() : '',
      text: (node.textContent || '').trim().slice(0, 160),
      selector: cssPath(node),
    }
  }

  function ensureHighlight(): HTMLElement {
    if (highlight) return highlight
    highlight = document.createElement('div')
    highlight.style.cssText =
      'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #ff4d8d;' +
      'background:rgba(255,77,141,0.12);border-radius:3px;box-sizing:border-box'
    document.documentElement.appendChild(highlight)
    return highlight
  }

  function clearHighlight() {
    if (highlight) {
      highlight.remove()
      highlight = null
    }
  }

  function onHover(event: MouseEvent) {
    const target = event.target as Element | null
    if (!target || target === highlight) return
    const rect = target.getBoundingClientRect()
    const h = ensureHighlight()
    h.style.left = `${rect.left}px`
    h.style.top = `${rect.top}px`
    h.style.width = `${rect.width}px`
    h.style.height = `${rect.height}px`
    event.stopPropagation()
    event.preventDefault()
  }

  function onPick(event: MouseEvent) {
    const target = event.target as Element | null
    event.stopPropagation()
    event.preventDefault()
    if (!target) return
    post('element-selected', { element: describe(target) })
    setSelectMode(false)
  }

  function setSelectMode(on: boolean) {
    if (!document.body) return
    if (on) {
      document.addEventListener('mousemove', onHover, true)
      document.addEventListener('click', onPick, true)
      document.body.style.cursor = 'crosshair'
    } else {
      document.removeEventListener('mousemove', onHover, true)
      document.removeEventListener('click', onPick, true)
      document.body.style.cursor = ''
      clearHighlight()
    }
  }

  post('ready', { href: window.location.href, title: document.title })
}

function format(value) {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack || value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export {}
