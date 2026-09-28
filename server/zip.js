/* Minimal, dependency-free ZIP writer (store method, no compression).
 * Produces archives that Windows Explorer / macOS Finder / unzip can open. */

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const EXCLUDED = new Set(['node_modules', '.git', 'dist', '.vite', '.cache', 'coverage'])

/** Dotenv files hold secrets; the example file is the one meant to travel. */
function isExcluded(name) {
  if (EXCLUDED.has(name)) return true
  if (name === '.env') return true
  return name.startsWith('.env.') && name !== '.env.example'
}

let CRC_TABLE = null
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE
  CRC_TABLE = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    CRC_TABLE[n] = c
  }
  return CRC_TABLE
}

function crc32(buf) {
  const table = crcTable()
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear())
  const d = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  const t = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  return { date: d, time: t }
}

async function collect(root, dir, prefix, out) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (isExcluded(entry.name)) continue
    const full = path.join(dir, entry.name)
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await collect(root, full, name, out)
    } else if (entry.isFile()) {
      const info = await stat(full)
      out.push({ name, buf: await readFile(full), mtime: info.mtime })
    }
  }
}

/** Build a ZIP buffer of `rootDir`, skipping build output and any dotenv file. */
export async function zipDirectory(rootDir) {
  const files = []
  await collect(rootDir, rootDir, '', files)

  const chunks = []
  const central = []
  let offset = 0

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8')
    const crc = crc32(file.buf)
    const { date, time } = dosDateTime(file.mtime)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(file.buf.length, 18)
    local.writeUInt32LE(file.buf.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, nameBuf, file.buf)
    central.push({ nameBuf, crc, size: file.buf.length, offset, date, time })
    offset += 30 + nameBuf.length + file.buf.length
  }

  const centralStart = offset
  for (const c of central) {
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0, 8)
    entry.writeUInt16LE(0, 10)
    entry.writeUInt16LE(c.time, 12)
    entry.writeUInt16LE(c.date, 14)
    entry.writeUInt32LE(c.crc, 16)
    entry.writeUInt32LE(c.size, 20)
    entry.writeUInt32LE(c.size, 24)
    entry.writeUInt16LE(c.nameBuf.length, 28)
    entry.writeUInt16LE(0, 30)
    entry.writeUInt16LE(0, 32)
    entry.writeUInt16LE(0, 34)
    entry.writeUInt16LE(0, 36)
    entry.writeUInt32LE(0, 38)
    entry.writeUInt32LE(c.offset, 42)
    chunks.push(entry, c.nameBuf)
    offset += 46 + c.nameBuf.length
  }

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(central.length, 8)
  end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(offset - centralStart, 12)
  end.writeUInt32LE(centralStart, 16)
  end.writeUInt16LE(0, 20)
  chunks.push(end)

  return Buffer.concat(chunks)
}
