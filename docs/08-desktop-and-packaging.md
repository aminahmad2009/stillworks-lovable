# 8 · Desktop app & packaging

`electron/main.js` wraps the same zero-dependency server in a native window. It is a thin shell: no
IPC-driven features beyond opening external links, and no second Node runtime.

## Boot sequence

1. **Single-instance lock.** `app.requestSingleInstanceLock()`; a second launch quits and focuses the
   running window via the `second-instance` event.
2. **Port discovery.** `getFreePort(4310)` probes upward for up to 60 ports, so a desktop app and a
   CLI run can coexist.
3. **Data directory.** Packaged: `%APPDATA%/Stillworks/data` (`app.getPath('userData')`) — because
   `resources/app` is read-only after install. In dev: the repository's `./data`, so both modes see
   the same projects.
4. **Rename migration.** The product was previously "Lovable Local", whose data lived in
   `%APPDATA%/Lovable Local/data`. On packaged first launch, `migrateLegacyData()` copies any legacy
   folder listed in `package.json → legacyProductNames` into the new location — only if the new
   `registry.json` is missing, never overwriting, and **never deleting the original** — then logs the
   source path and raises a notification. An upgrade must never open to an empty project list.
5. **Environment first, import second.** `PORT`, `HOST` and `STILLWORKS_DATA_DIR` are set *before*
   `await import('../server/index.js')`, since `server/config.js` reads them at module-evaluation
   time. Importing statically would bake in the defaults. `LOVABLE_DATA_DIR` is still honoured as a
   deprecated alias so existing scripts and shortcuts keep working.
6. **Readiness wait.** `waitForServer()` polls `/api/health` every 250 ms for up to 25 s before the
   window loads the URL.
7. **Window + tray.** 1440×900 (min 940×600), dark background, `autoHideMenuBar: true`,
   `contextIsolation: true`, `nodeIntegration: false`, preload at `electron/preload.cjs`.

## Window behaviour

- **No native menubar.** `Menu.setApplicationMenu(null)` removes File/Edit/View/Window entirely; the
  tray menu and the in-app UI cover everything, and Chromium still handles clipboard shortcuts in
  inputs. `app.setAboutPanelOptions` still registers product name, version, product ID, publisher,
  copyright and repository so OS-level metadata is correct.
- **Close hides to tray.** The `close` event is intercepted unless the app is really quitting; only
  the tray's **Quit** exits. `window-all-closed` is a no-op so the app survives with no window.
- **External links.** `setWindowOpenHandler` sends any `http(s)` target to the system browser instead
  of opening a bare Electron window — that matters for "Open ↗" on the preview. The preload bridge
  exposes an `open-external` IPC channel for the same purpose.
- **Tray.** Icon resized to 16×16, tooltip `Stillworks v0.2.0 — CodeWoxy`, menu showing product
  name and publisher (disabled header rows), Open, Open in Browser, Quit. Clicking the tray icon
  restores the window.

## Shutdown

`before-quit` is prevented once, `manager.stopAll()` is imported dynamically and awaited so every
child Vite process is killed, then `app.exit(0)`. Without this, orphaned dev servers keep their ports
after the app closes.

## Packaging

`package.json → build` drives electron-builder:

```jsonc
{
  "appId": "com.codewoxy.stillworks",
  "productName": "Stillworks",
  "copyright": "Copyright © 2026 CodeWoxy",
  "artifactName": "${productName}-Setup-${version}.${ext}",
  "asar": false,
  "files": ["server/**/*", "web/**/*", "electron/**/*", "build/icon.png",
            "package.json", "README.md", "CHANGELOG.md", "docs/**/*"],
  "win": { "target": [{ "target": "nsis", "arch": ["x64"] }], "publisherName": "CodeWoxy" },
  "nsis": { "oneClick": false, "perMachine": false, "allowToChangeInstallationDirectory": true,
            "createDesktopShortcut": true, "createStartMenuShortcut": true }
}
```

Notes:

- **`asar: false`** keeps the app as plain files. The server spawns `npm`, `npx` and `git` from the
  system PATH and reads its own templates from disk, which is simpler to reason about unpacked.
- **Versioned artifacts.** `artifactName` puts the semver in the installer filename, so
  `Stillworks-Setup-0.2.0.exe` cannot be confused with an older build.
- `release/` is git-ignored; installers are ~80 MB and reproducible from source.

### Building

```bash
npm install          # once
npm run dist:win     # → release/Stillworks-Setup-0.2.0.exe
```

If the build fails with `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` or "Access is denied" on a DLL, a
previous instance is still running and holding `release/win-unpacked`:

```bash
taskkill //IM "Stillworks.exe" //F
rm -rf release/win-unpacked
npm run dist:win
```

The first build on a machine downloads Electron and the winCodeSign package; a corporate proxy or a
stale cache is the usual cause of a hang there.

### Verifying a build

```bash
node -e "const p=require('./package.json');console.log(p.version, p.build.appId)"
npm run version:check          # CHANGELOG and the panel metadata name this version
```

Then install, launch, and confirm the sidebar version chip and the About panel both show the version
you intended, and that the data directory is under `%APPDATA%`.

## Icons and web assets

`build/icon.png` is the single source of truth: a 1024 px master used by electron-builder for the
installer, shortcuts and the window icon (`electron/main.js` loads it through `nativeImage`).

The panel's own icon set is derived from it, never redrawn:

```bash
npm run icons:build     # make-icons.ps1 (System.Drawing) then make-favicon-ico.mjs
```

That writes `web/icons/` — `icon-16/32/48/192/512.png`, `apple-touch-icon.png`, `maskable-512.png`,
`favicon.ico` (the three small sizes, PNG-encoded) and `og-image.png` (1200×630).

One quirk worth knowing: the master paints its rounded square on an **opaque white page** — its corners
are white pixels, not transparency. Scaling it straight to 16 px shows a white box, so `make-icons.ps1`
measures the artwork's own corner radius and clips the favicons to it, and over-scans the iOS and
maskable variants instead, which must be full-bleed squares. `tests/assets.test.js` pins the dimensions,
the RGBA-versus-opaque split, the ICO directory and the manifest references, so a stale or hand-edited
asset fails CI.

The panel's crawler metadata lives in the `<head>` of `web/index.html`: description, theme colors for
both palettes, the icon links, `og:`/`twitter:` tags, `robots.txt`, `site.webmanifest`, and a
`SoftwareApplication` JSON-LD block whose `softwareVersion` `npm run version:check` keeps in step with
`package.json`. None of it renders, and `og:url` is deliberately absent — the panel is served from an
arbitrary localhost port, so a hard-coded origin would be wrong; add absolute `og:url` and `og:image`
values if you ever publish it.
