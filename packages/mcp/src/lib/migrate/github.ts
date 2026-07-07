import { execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname, basename } from 'node:path'

const OPENAPI_FILENAMES = [
  'openapi.json', 'openapi.yaml', 'openapi.yml',
  'swagger.json', 'swagger.yaml', 'swagger.yml',
]

export interface OpenApiSpec {
  absPath: string
  filename: string
}

export function detectOpenApiSpec(cloneDir: string): OpenApiSpec | null {
  return findOpenApiSpec(cloneDir, 0)
}

function findOpenApiSpec(dir: string, depth: number): OpenApiSpec | null {
  if (depth > 3) return null

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }

  // Check current directory first
  for (const filename of OPENAPI_FILENAMES) {
    if (entries.includes(filename)) {
      return { absPath: join(dir, filename), filename }
    }
  }

  // Recurse into subdirectories (skip hidden dirs and node_modules)
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules') continue
    const fullPath = join(dir, entry)
    try {
      if (statSync(fullPath).isDirectory()) {
        const found = findOpenApiSpec(fullPath, depth + 1)
        if (found) return found
      }
    } catch {
      // skip
    }
  }

  return null
}

export interface GitHubSource {
  owner: string
  repo: string
  branch: string   // 'HEAD' if not specified
  docsDir: string  // '' = repo root, 'docs', 'documentation', etc.
  cloneUrl: string // https://github.com/owner/repo.git
}

export interface DocFile {
  absPath: string  // full path on disk inside temp clone
  relPath: string  // relative to docsDir root
  pageId: string   // e.g. 'guides/getting-started'
  ext: string      // '.md', '.mdx', '.rst', etc.
}

export function parseGitHubUrl(rawUrl: string): GitHubSource {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }

  if (url.hostname !== 'github.com') {
    throw new Error(`URL must be a github.com URL, got: ${url.hostname}`)
  }

  const parts = url.pathname.replace(/^\//, '').split('/')
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`GitHub URL must include owner and repo: ${rawUrl}`)
  }

  const owner = parts[0]
  const repo = parts[1]
  let branch = 'HEAD'
  let docsDir = ''

  if (parts.length >= 4 && parts[2] === 'tree') {
    branch = parts[3]
    if (parts.length > 4) {
      docsDir = parts.slice(4).join('/')
    }
  }

  const cloneUrl = `https://github.com/${owner}/${repo}.git`
  return { owner, repo, branch, docsDir, cloneUrl }
}

export async function cloneRepo(source: GitHubSource, targetDir: string): Promise<void> {
  const parts = ['git', 'clone', '--depth', '1']
  if (source.branch !== 'HEAD') {
    parts.push('--branch', source.branch)
  }
  parts.push(source.cloneUrl, targetDir)
  const cmd = parts.join(' ')

  try {
    execSync(cmd, { stdio: 'pipe' })
  } catch (err) {
    const stderr =
      (err as NodeJS.ErrnoException & { stderr?: Buffer }).stderr?.toString().trim() ?? ''
    const msg = stderr || (err instanceof Error ? err.message : String(err))
    throw new Error(`Failed to clone ${source.cloneUrl}: ${msg}`)
  }
}

const MD_EXTENSIONS = new Set(['.md', '.mdx'])
const ALL_DOC_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt'])

function hasMdFiles(dir: string): boolean {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return false
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        if (hasMdFiles(fullPath)) return true
      } else if (MD_EXTENSIONS.has(extname(entry).toLowerCase())) {
        return true
      }
    } catch {
      // skip
    }
  }
  return false
}

export function detectDocsDir(cloneDir: string): string {
  const candidates = [
    'docs',
    'documentation',
    'content',
    'pages',
    'src/content',
    'src/pages',
    'guide',
    'guides',
    '',
  ]

  for (const candidate of candidates) {
    const fullPath = candidate ? join(cloneDir, candidate) : cloneDir
    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory() && hasMdFiles(fullPath)) {
        return candidate
      }
    } catch {
      // skip
    }
  }

  return ''
}

function slugifySegment(seg: string): string {
  return seg
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function derivePageId(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  const filename = parts[parts.length - 1]
  const dirs = parts.slice(0, -1)
  const base = basename(filename, extname(filename))

  if (dirs.length === 0 && base.toLowerCase() === 'readme') {
    return 'introduction'
  }

  if (base.toLowerCase() === 'index') {
    if (dirs.length === 0) return 'introduction'
    return dirs.map(slugifySegment).join('/')
  }

  return [...dirs, base].map(slugifySegment).join('/')
}

function scanDir(dir: string, baseDir: string, primaryOnly: boolean, results: DocFile[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.startsWith('_') || entry.startsWith('.') || entry === 'node_modules') continue

    const fullPath = join(dir, entry)
    let stat
    try {
      stat = statSync(fullPath)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      scanDir(fullPath, baseDir, primaryOnly, results)
    } else {
      const ext = extname(entry).toLowerCase()
      const validExt = primaryOnly ? MD_EXTENSIONS.has(ext) : ALL_DOC_EXTENSIONS.has(ext)
      if (!validExt) continue

      const relPath = relative(baseDir, fullPath)
      const pageId = derivePageId(relPath)
      results.push({ absPath: fullPath, relPath, pageId, ext })
    }
  }
}

export function findDocFiles(cloneDir: string, docsDir: string): DocFile[] {
  const baseDir = docsDir ? join(cloneDir, docsDir) : cloneDir

  const primaryResults: DocFile[] = []
  scanDir(baseDir, baseDir, true, primaryResults)
  if (primaryResults.length > 0) return primaryResults

  const allResults: DocFile[] = []
  scanDir(baseDir, baseDir, false, allResults)
  return allResults
}
