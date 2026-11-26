/**
 * Build-time provenance for automatic page dates. Git is consulted only for
 * clean tracked files at an exact HEAD, never for shallow-boundary guesses.
 * No-Git imports retain their own hash-bound generated cache between builds.
 */

import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { normalizePageUpdateDate, normalizePageUpdateMetadata, type PageUpdateMetadata } from '../../src/lib/page-update'

interface SourceEntry { content: string; pageUpdate?: PageUpdateMetadata; rawSha256?: string }
interface PageUpdateRecord { rawSha256: string; pageUpdate: PageUpdateMetadata }
interface PageUpdateCache { version: 1; files: Record<string, PageUpdateRecord> }

/** Internal generated cache, unrelated to customer configuration or attestation. */
export const PAGE_UPDATE_CACHE_PATH = '.thally/page-updates.json'

/** Batch repository work and bound it so large sites do not pay per-page process overhead. */
function historyDates(projectRoot: string, paths: Array<string>): Map<string, PageUpdateMetadata> {
  const result = new Map<string, PageUpdateMetadata>()
  const deadline = Date.now() + 5_000
  const git = (args: Array<string>) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('Page history collection deadline reached')
    return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: remaining, maxBuffer: 16 * 1024 * 1024 })
  }
  try {
    const head = git(['rev-parse', '--verify', 'HEAD']).trim()
    if (!/^[a-f0-9]{40}$/.test(head)) return result
    const shallowPath = path.resolve(projectRoot, git(['rev-parse', '--git-path', 'shallow']).trim())
    const shallow = new Set(existsSync(shallowPath) ? readFileSync(shallowPath, 'utf8').trim().split(/\s+/) : [])
    const tracked = new Map<string, string>()
    for (const record of git(['ls-tree', '-r', '-z', head]).split('\0')) {
      const tab = record.indexOf('\t')
      const sha = record.slice(0, tab).split(' ')[2]
      if (tab >= 0 && /^[a-f0-9]{40}$/.test(sha)) tracked.set(record.slice(tab + 1), sha)
    }
    const dirty = new Set<string>()
    const changes = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0')
    for (let index = 0; index < changes.length; index += 1) {
      const record = changes[index]
      if (!record) continue
      dirty.add(record.slice(3))
      if (/R|C/.test(record.slice(0, 2))) dirty.add(changes[++index])
    }
    const eligible = paths.filter((filePath) => {
      if (Date.now() >= deadline || !tracked.has(filePath) || dirty.has(filePath) || /[\u0000-\u001f\u007f]/.test(filePath)) return false
      try {
        const physical = path.join(projectRoot, filePath)
        if (!lstatSync(physical).isFile()) return false
        const bytes = readFileSync(physical)
        // Status can hide assume-unchanged files. Verify the physical bytes
        // against HEAD's Git blob identity before treating history as proof.
        const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
        return blob === tracked.get(filePath)
      } catch { return false }
    })
    if (!eligible.length) return result
    // Latest-touch history needs no rename traversal: a rename itself is a
    // change to the current physical path. One log records all current paths.
    const log = git(['log', '--max-count=5000', '--format=%x00THALLY_PAGE_DATE%x00%H%x00%cI%x00', '--name-only', '-z', head])
    const wanted = new Set(eligible)
    const seen = new Set<string>()
    const records = log.split('\0')
    let update: PageUpdateMetadata | undefined
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      if (record === 'THALLY_PAGE_DATE') {
        const sha = records[++index]
        const date = records[++index]
        update = /^[a-f0-9]{40}$/.test(sha) && !shallow.has(sha) ? normalizePageUpdateMetadata({ date, source: 'git' }) : undefined
      } else {
        const filePath = record.replace(/^\n/, '')
        if (!wanted.has(filePath) || seen.has(filePath)) continue
        seen.add(filePath)
        if (update) result.set(filePath, update)
      }
    }
  } catch {
    // Missing/incomplete history is an import/publication fact, never proof
    // that a page was updated on the checkout or build day.
  }
  return result
}

/** Never follow a generated-cache directory or file outside this project. */
function safeCachePath(projectRoot: string): string {
  const directory = path.join(projectRoot, '.thally')
  const inspect = (target: string, directoryExpected: boolean) => {
    try {
      const stats = lstatSync(target)
      if (stats.isSymbolicLink() || (directoryExpected ? !stats.isDirectory() : !stats.isFile())) throw new Error(`Page date cache path is not a regular ${directoryExpected ? 'directory' : 'file'}: ${target}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  inspect(directory, true)
  mkdirSync(directory, { recursive: true })
  const filePath = path.join(projectRoot, PAGE_UPDATE_CACHE_PATH)
  inspect(filePath, false)
  return filePath
}

function previousRecords(projectRoot: string): Record<string, PageUpdateRecord> {
  try {
    const value = JSON.parse(readFileSync(path.join(projectRoot, PAGE_UPDATE_CACHE_PATH), 'utf8')) as PageUpdateCache
    return value?.version === 1 && value.files && typeof value.files === 'object' && !Array.isArray(value.files) ? value.files : {}
  } catch { return {} }
}

/** Attach stable automatic dates to emitted sources and retain hash-bound state. */
export function attachPageUpdates(projectRoot: string, sources: Record<string, SourceEntry>, observedAt = process.env.THALLY_PAGE_UPDATE_OBSERVED_AT?.trim() || process.env.DOX_PAGE_UPDATE_OBSERVED_AT?.trim() || new Date().toISOString()): void {
  const capturedAt = normalizePageUpdateDate(observedAt)
  if (!capturedAt) throw new Error('THALLY_PAGE_UPDATE_OBSERVED_AT must be an ISO date or timestamp.')
  for (const filePath of Object.keys(sources)) {
    if (path.posix.isAbsolute(filePath) || filePath.includes('\\') || filePath.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe page date source path: ${filePath}`)
  }
  const cachePath = safeCachePath(projectRoot)
  const history = historyDates(projectRoot, Object.keys(sources))
  const previous = previousRecords(projectRoot)
  const records: Array<[string, PageUpdateRecord]> = []
  for (const [filePath, source] of Object.entries(sources)) {
    const rawSha256 = source.rawSha256 && /^[a-f0-9]{64}$/.test(source.rawSha256) ? source.rawSha256 : createHash('sha256').update(source.content).digest('hex')
    const old = Object.hasOwn(previous, filePath) ? previous[filePath] : undefined
    const retained = old && /^[a-f0-9]{64}$/.test(old.rawSha256) ? normalizePageUpdateMetadata(old.pageUpdate) : undefined
    const pageUpdate: PageUpdateMetadata = normalizePageUpdateMetadata(source.pageUpdate)
      ?? history.get(filePath)
      ?? (old?.rawSha256 === rawSha256 ? retained : undefined)
      ?? { date: capturedAt, source: retained ? 'content-change' : 'first-published' }
    source.pageUpdate = pageUpdate
    records.push([filePath, { rawSha256, pageUpdate }])
  }
  const temporary = path.join(path.dirname(cachePath), `.page-updates-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify({ version: 1, files: Object.fromEntries(records) })}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    safeCachePath(projectRoot)
    renameSync(temporary, cachePath)
  } finally { rmSync(temporary, { force: true }) }
}
