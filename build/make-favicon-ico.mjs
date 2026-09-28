/**
 * Wraps the generated PNG favicons into web/icons/favicon.ico.
 *
 * PNG-encoded ICO entries are what modern Windows and every current browser
 * read, and they keep the artwork identical to the PNGs rather than
 * re-compressing it to 256 colours. Run after build/make-icons.ps1:
 *
 *   node build/make-favicon-ico.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const iconsDir = path.join(root, 'web', 'icons')
const SIZES = [16, 32, 48]

const payloads = []
for (const size of SIZES) {
  const file = path.join(iconsDir, `icon-${size}.png`)
  const buf = await readFile(file).catch(() => {
    console.error(`missing ${path.basename(file)} — run build/make-icons.ps1 first`)
    process.exit(1)
  })
  payloads.push({ size, buf })
}

const HEADER = 6
const ENTRY = 16
const directory = Buffer.alloc(HEADER + ENTRY * payloads.length)
directory.writeUInt16LE(0, 0)            // reserved
directory.writeUInt16LE(1, 2)            // type: icon
directory.writeUInt16LE(payloads.length, 4)

let offset = directory.length
payloads.forEach((entry, index) => {
  const at = HEADER + ENTRY * index
  directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at)      // width
  directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1)  // height
  directory.writeUInt8(0, at + 2)        // palette entries
  directory.writeUInt8(0, at + 3)        // reserved
  directory.writeUInt16LE(1, at + 4)     // colour planes
  directory.writeUInt16LE(32, at + 6)    // bits per pixel
  directory.writeUInt32LE(entry.buf.length, at + 8)
  directory.writeUInt32LE(offset, at + 12)
  offset += entry.buf.length
})

const ico = Buffer.concat([directory, ...payloads.map((p) => p.buf)])
await writeFile(path.join(iconsDir, 'favicon.ico'), ico)
console.log(`favicon.ico: ${SIZES.join('/')} px, ${ico.length} bytes`)
