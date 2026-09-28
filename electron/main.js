/* Electron main process — wraps the zero-dependency Node server in a native
 * window. The server is imported in-process (same V8/Node runtime), so no
 * second Node install is needed to run it; child processes (vite/npm/git)
 * still come from the system PATH. */

import { app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage, ipcMain, Notification } from 'electron'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.png')

/** Build identity, read from package.json so it can never drift from the server. */
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
const APP_VERSION = pkg.version
const COMPANY = pkg.company || 'CodeWoxy'
const PRODUCT_NAME = pkg.build?.productName || pkg.productName || 'Stillworks'
const PRODUCT_ID = pkg.productId || 'codewoxy-stillworks'
/** Names this app shipped under before the current one. Their %APPDATA% folders
 *  are migrated forward on first launch, never deleted. */
const LEGACY_PRODUCT_NAMES = Array.isArray(pkg.legacyProductNames) ? pkg.legacyProductNames : []
const REPOSITORY = String(pkg.repository?.url || pkg.repository || '').replace(/^git\+/, '').replace(/\.git$/, '')

let mainWindow = null
let tray = null
let serverUrl = null
let quitting = false
let serversStopped = false

/* ------------------------------ server boot ----------------------------- */

/** First free port at or after `preferred`, so we never clash with a CLI run. */
function getFreePort(preferred = 4310, span = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (port) => {
      const probe = net.createServer()
      probe.once('error', () => {
        if (port < preferred + span) attempt(port + 1)
        else reject(new Error(`No free port in ${preferred}–${preferred + span}`))
      })
      probe.once('listening', () => probe.close(() => resolve(port)))
      probe.listen(port, '127.0.0.1')
    }
    attempt(preferred)
  })
}

function waitForServer(url, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(`${url}/api/health`, (res) => {
        res.resume()
        if (res.statusCode === 200) resolve()
        else retry()
      })
      req.on('error', retry)
      req.setTimeout(1500, () => { req.destroy(); retry() })
    }
    const retry = () => {
      if (Date.now() > deadline) reject(new Error('Server did not become ready in time'))
      else setTimeout(ping, 250)
    }
    ping()
  })
}

/**
 * The product was renamed, which moves %APPDATA%/<old name>/data. Copy the old
 * tree across once and leave the original in place: an upgrade that opens to an
 * empty project list reads as lost work, and a copy the customer can undo beats
 * a move they cannot.
 *
 * Returns the path it migrated from, or null when there was nothing to do.
 */
async function migrateLegacyData(target) {
  if (existsSync(path.join(target, 'registry.json'))) return null
  const { cp, mkdir } = await import('node:fs/promises')

  for (const name of LEGACY_PRODUCT_NAMES) {
    const previous = path.join(app.getPath('appData'), name, 'data')
    if (!existsSync(path.join(previous, 'registry.json'))) continue
    await mkdir(target, { recursive: true })
    await cp(previous, target, { recursive: true, force: false, errorOnExist: false })
    return previous
  }
  return null
}

async function startServer() {
  const port = await getFreePort(Number(process.env.PORT) || 4310)

  // Once installed, resources/app is read-only, so project data must live in a
  // writable location. In dev we reuse the repo's ./data for convenience.
  const dataDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(__dirname, '..', 'data')

  // Must happen before the server is imported: config.js resolves DATA_DIR once,
  // at module-eval time.
  const migratedFrom = app.isPackaged ? await migrateLegacyData(dataDir) : null

  process.env.PORT = String(port)
  process.env.HOST = '127.0.0.1'
  process.env.STILLWORKS_DATA_DIR = dataDir

  // config.js reads these env vars at module-eval time, so the server must be
  // imported dynamically *after* they are set.
  await import('../server/index.js')

  if (migratedFrom) {
    console.log(`[app] migrated project data from ${migratedFrom} to ${dataDir}; the original is untouched`)
    try {
      new Notification({
        title: `${PRODUCT_NAME} has moved your projects`,
        body: `Copied from ${migratedFrom}\nThe old folder is still there, untouched.`,
      }).show()
    } catch { /* notifications are unavailable in some sessions; the log line is enough */ }
  }

  serverUrl = `http://127.0.0.1:${port}`
  await waitForServer(serverUrl)
  return { url: serverUrl, dataDir }
}

/* -------------------------------- window -------------------------------- */

function showWindow() {
  if (!mainWindow) createWindow()
  else if (mainWindow.isMinimized()) mainWindow.restore()
  else mainWindow.show()
  mainWindow.focus()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 600,
    title: `${PRODUCT_NAME} · ${COMPANY}`,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(ICON_PATH),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadURL(serverUrl)

  // Links that point away from the control panel (e.g. "open preview") go to
  // the real browser instead of a bare Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' } }
    return { action: 'allow' }
  })

  // Closing hides to the tray; only Quit really exits.
  mainWindow.on('close', (event) => {
    if (!quitting) { event.preventDefault(); mainWindow.hide() }
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

function buildAppMenu() {
  // No native menubar (File/Edit/View/Window). The tray menu and in-app UI
  // cover everything; Chromium still handles clipboard shortcuts in inputs.
  Menu.setApplicationMenu(null)

  // Still register the build identity so the OS-level About box (and the
  // installer metadata) reports the right publisher, version and product id.
  app.setName(PRODUCT_NAME)
  app.setAboutPanelOptions({
    applicationName: PRODUCT_NAME,
    applicationVersion: APP_VERSION,
    version: PRODUCT_ID,
    copyright: `Copyright © ${new Date().getFullYear()} ${COMPANY}`,
    authors: [COMPANY],
    website: REPOSITORY || undefined,
  })
}

function createTray() {
  let image = nativeImage.createFromPath(ICON_PATH)
  if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 })
  tray = new Tray(image)
  tray.setToolTip(`${PRODUCT_NAME} v${APP_VERSION} — ${COMPANY}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `${PRODUCT_NAME} v${APP_VERSION}`, enabled: false },
    { label: `Built by ${COMPANY}`, enabled: false },
    { type: 'separator' },
    { label: `Open ${PRODUCT_NAME}`, click: () => showWindow() },
    { label: 'Open in Browser', click: () => serverUrl && shell.openExternal(serverUrl) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit() } },
  ]))
  tray.on('click', () => showWindow())
}

/* ------------------------------- lifecycle ------------------------------ */

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(async () => {
    buildAppMenu()
    ipcMain.on('open-external', (_event, url) => {
      if (typeof url === 'string' && /^https?:/i.test(url)) shell.openExternal(url)
    })
    try {
      const { url, dataDir } = await startServer()
      createWindow()
      createTray()
      console.log(`[desktop] ${PRODUCT_NAME} v${APP_VERSION} (${PRODUCT_ID}) — ${COMPANY}`)
      console.log(`[desktop] server ready at ${url} (data: ${dataDir})`)
    } catch (err) {
      dialog.showErrorBox(`${PRODUCT_NAME} failed to start`, err.stack || err.message)
      app.exit(1)
    }

    app.on('activate', () => showWindow())
  })

  // Keep running in the tray when the window is closed.
  app.on('window-all-closed', () => { /* no-op: tray keeps the app alive */ })

  // Stop every child dev server before the process goes away.
  app.on('before-quit', (event) => {
    if (serversStopped) return
    event.preventDefault()
    serversStopped = true
    import('../server/devserver.js')
      .then(({ manager }) => manager.stopAll())
      .catch(() => {})
      .finally(() => { quitting = true; app.exit(0) })
  })
}
