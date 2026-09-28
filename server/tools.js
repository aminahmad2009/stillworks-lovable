import path from 'node:path'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { generateImage } from './llm/image.js'
import { childEnv } from './config.js'

const IS_WINDOWS = process.platform === 'win32'
const MAX_READ_BYTES = 400_000
const MAX_LIST_ENTRIES = 400
const COMMAND_TIMEOUT = 180_000

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.vite', '.cache', 'coverage'])

/**
 * Commands the agent may run. Anything else is refused rather than executed —
 * the agent has full write access inside the project, so the shell is the one
 * place a hard allowlist is worth the friction.
 */
const COMMAND_ALLOWLIST = [
  /^npm\s+(install|i|ci|run|ls|list|view|uninstall|update|audit|init|test)\b/i,
  /^npx\s+(vite|tsc|tailwindcss|prettier|eslint)\b/i,
  /^node\s+[\w./\\-]+\.(m?js|ts)\b/i,
  /^git\s+(status|diff|log|add|commit|show|restore|checkout)\b/i,
  /^tsc\b/i,
  /^pnpm\s+(install|add|run|list)\b/i,
  /^yarn\s+(install|add|run|list)\b/i,
]

// The command runs through a shell, so a match at the start proves nothing about
// what follows: every `;`, `&`, `|` or newline-separated segment is checked too.
const SEGMENT_SPLIT = /[;&|\n]+/
// Substitution and redirection bypass segmentation entirely, and `>` could write
// outside the project where the file tools cannot.
const UNSAFE_SHELL = /`|\$\(|[<>]/

export function resolveInside(root, candidate) {
  const resolved = path.resolve(root, candidate || '.')
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the project directory: ${candidate}`)
  }
  return resolved
}

function rel(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/')
}

async function* walk(root, dir = root, depth = 0) {
  if (depth > 8) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (IGNORED_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield { type: 'dir', path: rel(root, full) }
      yield* walk(root, full, depth + 1)
    } else if (entry.isFile()) {
      let size = 0
      try { size = (await stat(full)).size } catch { /* ignore */ }
      yield { type: 'file', path: rel(root, full), size }
    }
  }
}

function truncate(text, limit = MAX_READ_BYTES) {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n\n… truncated (${text.length - limit} more characters)`
}

/* --------------------------------- tools --------------------------------- */

async function listFiles(root, args) {
  const target = resolveInside(root, args.path || '.')
  const out = []
  for await (const entry of walk(target)) {
    out.push(entry.type === 'dir' ? `${entry.path}/` : `${entry.path} (${entry.size}b)`)
    if (out.length >= MAX_LIST_ENTRIES) {
      out.push(`… truncated at ${MAX_LIST_ENTRIES} entries`)
      break
    }
  }
  return out.length ? out.join('\n') : '(empty directory)'
}

async function readFileTool(root, args) {
  if (!args.path) throw new Error('path is required')
  const target = resolveInside(root, args.path)
  if (!existsSync(target)) throw new Error(`File not found: ${args.path}`)
  const content = await readFile(target, 'utf8')
  if (args.withLineNumbers !== false) {
    return truncate(
      content
        .split('\n')
        .map((line, i) => `${String(i + 1).padStart(4)}\t${line}`)
        .join('\n'),
    )
  }
  return truncate(content)
}

async function writeFileTool(root, args) {
  if (!args.path) throw new Error('path is required')
  if (typeof args.content !== 'string') throw new Error('content must be a string')
  const target = resolveInside(root, args.path)
  await mkdir(path.dirname(target), { recursive: true })
  const existed = existsSync(target)
  await writeFile(target, args.content, 'utf8')
  return `${existed ? 'Updated' : 'Created'} ${args.path} (${args.content.length} chars)`
}

async function editFileTool(root, args) {
  if (!args.path) throw new Error('path is required')
  if (typeof args.old_string !== 'string' || typeof args.new_string !== 'string') {
    throw new Error('old_string and new_string must both be strings')
  }
  if (args.old_string === args.new_string) throw new Error('old_string and new_string are identical')

  const target = resolveInside(root, args.path)
  if (!existsSync(target)) throw new Error(`File not found: ${args.path}`)

  const original = await readFile(target, 'utf8')
  const occurrences = original.split(args.old_string).length - 1

  if (occurrences === 0) {
    throw new Error(
      `old_string not found in ${args.path}. Read the file first and copy the exact text including indentation.`,
    )
  }
  if (occurrences > 1 && !args.replace_all) {
    throw new Error(
      `old_string matches ${occurrences} places in ${args.path}. Add more surrounding context to make it unique, or set replace_all=true.`,
    )
  }

  const next = args.replace_all
    ? original.split(args.old_string).join(args.new_string)
    : original.replace(args.old_string, args.new_string)

  await writeFile(target, next, 'utf8')
  return `Edited ${args.path}: replaced ${args.replace_all ? occurrences : 1} occurrence(s)`
}

async function deleteFileTool(root, args) {
  if (!args.path) throw new Error('path is required')
  const target = resolveInside(root, args.path)
  if (!existsSync(target)) return `Nothing to delete: ${args.path}`
  await rm(target, { recursive: true, force: true })
  return `Deleted ${args.path}`
}

async function searchFiles(root, args) {
  if (!args.pattern) throw new Error('pattern is required')
  let regex
  try {
    regex = new RegExp(args.pattern, args.ignoreCase === false ? 'g' : 'gi')
  } catch (err) {
    throw new Error(`Invalid regex: ${err.message}`)
  }

  const hits = []
  for await (const entry of walk(root)) {
    if (entry.type !== 'file' || entry.size > 2_000_000) continue
    if (args.filePattern && !new RegExp(args.filePattern, 'i').test(entry.path)) continue
    let content
    try {
      content = await readFile(path.join(root, entry.path), 'utf8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        hits.push(`${entry.path}:${i + 1}: ${lines[i].trim().slice(0, 240)}`)
        if (hits.length >= 120) return hits.concat('… truncated at 120 matches').join('\n')
      }
      regex.lastIndex = 0
    }
  }
  return hits.length ? hits.join('\n') : `No matches for /${args.pattern}/`
}

const IMAGE_DIR = 'public/generated'
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'image'
}

/**
 * Generate an image with the configured OpenAI-compatible image model and
 * save it inside the project. Files land in `public/generated/` by default so
 * Vite serves them from the site root (`/generated/name.png`).
 */
async function imageGenerationTool(root, args, ctx = {}) {
  const prompt = String(args.prompt || '').trim()
  if (!prompt) throw new Error('prompt is required')

  const size = String(args.size || ctx.settings?.image?.size || '1024x1024')
  const generated = await generateImage({
    settings: ctx.settings || {},
    provider: ctx.provider,
    prompt,
    size,
    signal: ctx.signal,
  })

  let relative
  if (args.path) {
    relative = String(args.path).replace(/^\/+/, '')
    if (!IMAGE_EXT.test(relative)) relative += `.${generated.ext}`
  } else {
    relative = `${IMAGE_DIR}/${slugify(prompt)}-${Date.now().toString(36)}.${generated.ext}`
  }

  const target = resolveInside(root, relative)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, generated.buffer)

  const urlPath = relative.startsWith('public/') ? `/${relative.slice('public/'.length)}` : `/${relative}`
  const kb = Math.round(generated.buffer.length / 1024)
  return [
    `Saved ${size} image to ${relative} (${kb} KB, ${generated.ext.toUpperCase()})`,
    `Model: ${generated.model} via ${generated.source}`,
    `Reference it in code as "${urlPath}" — that path is served by the dev server.`,
  ].join('\n')
}

/** The first segment a command runs that the allowlist does not cover, or null. */
export function findUnpermitted(command) {
  if (UNSAFE_SHELL.test(command)) return command
  for (const segment of command.split(SEGMENT_SPLIT)) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    if (!COMMAND_ALLOWLIST.some((re) => re.test(trimmed))) return trimmed
  }
  return null
}

function runCommand(root, args, onLog) {
  if (!args.command || typeof args.command !== 'string') {
    return Promise.reject(new Error('command is required'))
  }
  const command = args.command.trim()
  const unpermitted = findUnpermitted(command)
  if (unpermitted) {
    return Promise.resolve(
      `Refused: "${command}" is not on the allowlist${unpermitted === command ? '' : ` ("${unpermitted}" is not)`}. ` +
      `Permitted commands are npm/npx/pnpm/yarn package and script operations, node on a project script, ` +
      `tsc, and read-mostly git — one command per call, without chaining, substitution or redirection. ` +
      `If this was mkdir: write_file and edit_file create every missing parent directory themselves, ` +
      `so write the files inside the new folders directly and keep going. ` +
      `Anything else genuinely needs the shell — tell the user to run it themselves.`,
    )
  }

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: root,
      shell: true,
      env: childEnv(),
      windowsHide: true,
    })

    let output = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      resolve(`${output}\n\n[command timed out after ${COMMAND_TIMEOUT / 1000}s]`.trim())
    }, COMMAND_TIMEOUT)

    const collect = (buf) => {
      const text = buf.toString()
      output += text
      if (output.length > 60_000) output = output.slice(-60_000)
      onLog?.(text)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve(`Command failed to start: ${err.message}`)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const tail = output.slice(-12_000).trim()
      resolve(`exit code ${code}\n\n${tail || '(no output)'}`)
    })
  })
}

export const TOOL_DEFINITIONS = [
  {
    name: 'list_files',
    description: 'List the project file tree (node_modules, .git and dist are hidden). Call this first in an unfamiliar project.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Subdirectory to list, relative to project root. Defaults to ".".' } },
      required: [],
    },
  },
  {
    name: 'read_file',
    description: 'Read a text file from the project, returned with line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root.' },
        withLineNumbers: { type: 'boolean', description: 'Default true. Set false to get raw content.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create a file or overwrite it completely. Use for new files and full rewrites.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root.' },
        content: { type: 'string', description: 'Complete file content.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact string in an existing file. Prefer this over write_file for changes to large files.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string', description: 'Exact text to replace, including indentation. Must be unique unless replace_all is true.' },
        new_string: { type: 'string', description: 'Replacement text.' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence. Default false.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or directory inside the project.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'Regex search across project file contents. Returns path:line matches.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression to search for.' },
        filePattern: { type: 'string', description: 'Optional regex filter on file path, e.g. "\\.tsx$".' },
        ignoreCase: { type: 'boolean', description: 'Default true.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'image_generation',
    description: 'Generate a raster image with the configured image model and save it into the project. Use this for real artwork — hero images, illustrations, product shots, textures, avatars — instead of SVG placeholders. Returns the path to reference in code.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed visual description: subject, style, lighting, colors, aspect.' },
        path: { type: 'string', description: 'Optional destination relative to the project root, e.g. "public/generated/hero.png". Defaults to a generated name under public/generated/.' },
        size: { type: 'string', description: 'Optional pixel size, e.g. "1024x1024", "1536x1024", "1024x1536". Defaults to the configured size.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'run_command',
    description: 'Run an allowlisted shell command in the project root (npm install, npm run build, npx tsc, git status, …). Use it to install dependencies and to verify the build compiles. Not needed to create folders: write_file and edit_file create parent directories on their own, and mkdir is not on the allowlist.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'The command to run.' } },
      required: ['command'],
    },
  },
]

const HANDLERS = {
  list_files: listFiles,
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  delete_file: deleteFileTool,
  search_files: searchFiles,
  image_generation: imageGenerationTool,
}

/** Execute one tool call. Never throws — failures come back as text for the model. */
export async function executeTool(name, args, ctx = {}) {
  const { root, onLog } = ctx
  try {
    // Dispatch to an MCP server if the tool name is qualified.
    if (name.startsWith('mcp__')) {
      const { executeMcpTool } = await import('./mcp/manager.js')
      return await executeMcpTool(name, args)
    }
    if (name === 'run_command') return await runCommand(root, args || {}, onLog)
    const handler = HANDLERS[name]
    if (!handler) return `Unknown tool: ${name}`
    return await handler(root, args || {}, ctx)
  } catch (err) {
    return `ERROR: ${err.message}${err.hint ? `\nHint: ${err.hint}` : ''}`
  }
}
