import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (rel) => readFile(path.join(root, rel))

/** PNG width/height live in the IHDR chunk at fixed offsets. */
function pngSize(buf) {
  assert.equal(buf.readUInt32BE(0), 0x89504e47, 'not a PNG signature')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colorType: buf[25] }
}

test('every icon exists at the size its name claims', async () => {
  const square = {
    'web/icons/icon-16.png': 16,
    'web/icons/icon-32.png': 32,
    'web/icons/icon-48.png': 48,
    'web/icons/icon-192.png': 192,
    'web/icons/icon-512.png': 512,
    'web/icons/apple-touch-icon.png': 180,
    'web/icons/maskable-512.png': 512,
  }
  for (const [file, size] of Object.entries(square)) {
    const dims = pngSize(await read(file))
    assert.equal(dims.width, size, `${file} width`)
    assert.equal(dims.height, size, `${file} height`)
    assert.equal(dims.bitDepth, 8, `${file} should be 8-bit`)
  }
})

test('favicons carry transparency and differ from the full-bleed variants', async () => {
  // build/icon.png paints its rounded square on an opaque white page, so the web
  // set must key the corners out or they read as a white box on the dark panel.
  const rounded = pngSize(await read('web/icons/icon-512.png'))
  assert.equal(rounded.colorType, 6, 'favicon PNGs must be RGBA')

  // iOS and maskable slots want a solid square, produced by over-scanning the
  // same artwork. Their PNG headers are identical at the same dimensions, so
  // compare the whole file rather than the leading bytes.
  const maskable = await read('web/icons/maskable-512.png')
  const favicon = await read('web/icons/icon-512.png')
  assert.notDeepEqual(Buffer.from(maskable), Buffer.from(favicon), 'maskable must be full bleed')
})

test('favicon.ico carries the 16/32/48 entries', async () => {
  const ico = await read('web/icons/favicon.ico')
  assert.equal(ico.readUInt16LE(0), 0, 'reserved field')
  assert.equal(ico.readUInt16LE(2), 1, 'type must be icon')
  const count = ico.readUInt16LE(4)
  assert.equal(count, 3)

  const sizes = []
  for (let i = 0; i < count; i++) {
    const at = 6 + 16 * i
    const width = ico.readUInt8(at) || 256
    const height = ico.readUInt8(at + 1) || 256
    assert.equal(width, height, 'entries must be square')
    assert.ok(ico.readUInt32LE(at + 12) + ico.readUInt32LE(at + 8) <= ico.length, 'entry fits in file')
    sizes.push(width)
  }
  assert.deepEqual(sizes.sort((a, b) => a - b), [16, 32, 48])
})

test('the social card is the 1.91:1 ratio crawlers expect', async () => {
  const { width, height } = pngSize(await read('web/icons/og-image.png'))
  assert.equal(width, 1200)
  assert.equal(height, 630)
})

test('the manifest names icons that actually exist', async () => {
  const manifest = JSON.parse(await read('web/site.webmanifest'))
  assert.equal(manifest.name, 'Stillworks')
  assert.ok(manifest.icons.length >= 2)
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'), 'needs a maskable variant')

  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('/icons/'), `${icon.src} must live under /icons/`)
    const bytes = await read(path.join('web', icon.src))
    assert.ok(bytes.length > 100, `${icon.src} looks empty`)
  }
})

test('the panel head carries icons and metadata without touching the body', async () => {
  const html = (await read('web/index.html')).toString('utf8')
  const head = html.slice(0, html.indexOf('</head>'))
  const body = html.slice(html.indexOf('<body>'))

  for (const needle of [
    'rel="icon"', 'rel="apple-touch-icon"', 'rel="manifest"',
    'name="description"', 'property="og:title"', 'property="og:image"',
    'name="twitter:card"', 'application/ld+json',
  ]) {
    assert.ok(head.includes(needle), `head is missing ${needle}`)
  }

  // The tab title is browser chrome, not app UI, but it must still be the product name.
  assert.ok(head.includes('<title>Stillworks · CodeWoxy</title>'))
  assert.ok(!body.includes('<meta ') && !body.includes('og:'), 'no metadata may leak into the body')

  const jsonLd = JSON.parse(head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])
  assert.equal(jsonLd['@type'], 'SoftwareApplication')
  assert.equal(jsonLd.name, 'Stillworks')
  assert.equal(jsonLd.softwareVersion, JSON.parse(await read('package.json')).version)

  const referenced = head.match(/(?:href|content)="\/(?:icons\/[^"]+|site\.webmanifest)"/g) || []
  assert.ok(referenced.length >= 6, 'expected icon, manifest and og:image references')
  for (const match of referenced) {
    const target = match.match(/"\/(.+)"/)[1]
    assert.ok((await read(path.join('web', target))).length > 0, `${target} is referenced but unreadable`)
  }
})

test('robots.txt exists and states the no-auth caveat', async () => {
  const robots = (await read('web/robots.txt')).toString('utf8')
  assert.match(robots, /User-agent: \*/)
  assert.match(robots, /no authentication/i)
})
