import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import matter from 'gray-matter'
import { parse as parseYaml } from 'yaml'
import { readDocsJson, writeDocsJson } from './docs-json.js'
import type { DocsJsonNavigationGroup } from './docs-json.js'

interface LintIssue {
  severity: 'error' | 'warning'
  message: string
  file?: string
  line?: number
}

export interface CheckOptions {
  fix: boolean
  ci: boolean
  /** Also HEAD-check external links (network). Off by default for deterministic CI. */
  external?: boolean
  /** Flag pages whose `sources` changed since their `verifiedCommit` (needs git history). */
  drift?: boolean
}

/** Run a git command in the project, returning success + trimmed stdout. */
function gitLocal(projectDir: string, args: Array<string>): { ok: boolean; out: string } {
  try {
    const out = execFileSync('git', args, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return { ok: true, out: out.trim() }
  } catch {
    return { ok: false, out: '' }
  }
}

/**
 * Provenance drift: a page is stale when a file it declares in `sources` has
 * changed since the `verifiedCommit` it was last checked against. Deterministic,
 * zero-inference. Fails toward "can't tell" — a verifiedCommit missing from
 * history (e.g. a shallow CI clone) is flagged, never silently passed.
 */
function checkDrift(projectDir: string, file: string, data: Record<string, unknown>, issues: Array<LintIssue>): void {
  const sources = data.sources
  const verifiedCommit = data.verifiedCommit
  if (!Array.isArray(sources) || sources.length === 0 || typeof verifiedCommit !== 'string' || !verifiedCommit.trim()) {
    return
  }

  const commit = verifiedCommit.trim()
  // Is the verified commit even in this checkout? Shallow clones drop old history.
  if (!gitLocal(projectDir, ['cat-file', '-e', `${commit}^{commit}`]).ok) {
    issues.push({
      severity: 'warning',
      message: `Cannot verify freshness: verifiedCommit "${commit.slice(0, 8)}" is not in git history — run with a full clone (fetch-depth: 0).`,
      file,
    })
    return
  }

  for (const src of sources) {
    if (typeof src !== 'string' || !src.trim()) continue
    const colon = src.indexOf(':')
    let filePath = src
    if (colon > 0) {
      const alias = src.slice(0, colon)
      if (alias !== '.' && alias !== 'self') {
        issues.push({
          severity: 'warning',
          message: `Cross-repo source "${src}" — drift check skipped (needs the referenced repo; see multi-repo setup).`,
          file,
        })
        continue
      }
      filePath = src.slice(colon + 1)
    }
    filePath = filePath.replace(/^\.\//, '').replace(/#.*$/, '') // strip ./ and #fragment
    const changed = gitLocal(projectDir, ['log', '--format=%H', `${commit}..HEAD`, '--', filePath]).out
    if (changed) {
      const n = changed.split('\n').filter(Boolean).length
      issues.push({
        severity: 'warning',
        message: `Drift: source "${src}" changed in ${n} commit(s) since it was verified — this page may be stale.`,
        file,
      })
    }
  }
}

function collectNavPageIds(
  groups: Array<string | DocsJsonNavigationGroup>,
  seen: Set<string>,
  duplicates: Set<string>,
): void {
  for (const page of groups) {
    if (typeof page === 'string') {
      if (seen.has(page)) duplicates.add(page)
      else seen.add(page)
    } else if (page.pages) {
      collectNavPageIds(page.pages, seen, duplicates)
    }
  }
}

function scanMdx(dir: string, results: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) scanMdx(fullPath, results)
      else if (extname(entry).toLowerCase() === '.mdx') results.push(fullPath)
    } catch {
      // skip
    }
  }
}

function addOrphanToNav(projectDir: string, pageId: string): void {
  const config = readDocsJson(projectDir)
  const tab = config.tabs.find((t) => !t.href && !t.api && t.groups && t.groups.length > 0)
  if (!tab?.groups) return
  const lastGroup = tab.groups[tab.groups.length - 1]
  const existing = lastGroup.pages.filter((p): p is string => typeof p === 'string')
  if (!existing.includes(pageId)) {
    lastGroup.pages.push(pageId)
    writeDocsJson(projectDir, config)
  }
}

/** Match Thally's heading-anchor slugs closely enough for link validation. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function extractHeadingAnchors(content: string): Set<string> {
  const anchors = new Set<string>()
  for (const line of content.split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) anchors.add(slugify(m[1]))
  }
  return anchors
}

interface FoundLink {
  target: string
  line: number
}

function extractLinks(content: string): FoundLink[] {
  const links: FoundLink[] = []
  const lines = content.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence
      continue
    }
    if (inFence) continue // don't link-check example URLs inside code blocks
    const line = lines[i].replace(/`[^`]*`/g, '') // strip inline code spans
    // Markdown links [text](target) and bare href="target"
    for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      links.push({ target: m[1], line: i + 1 })
    }
    for (const m of line.matchAll(/href=["']([^"']+)["']/g)) {
      links.push({ target: m[1], line: i + 1 })
    }
  }
  return links
}

function pageIdToPath(pageId: string): string {
  return pageId === 'introduction' ? '/' : `/${pageId}`
}

function validateOpenApi(projectDir: string, source: string, issues: LintIssue[]): void {
  const specPath = join(projectDir, source)
  if (!existsSync(specPath)) {
    issues.push({ severity: 'error', message: `API reference points at "${source}" but the file does not exist`, file: source })
    return
  }
  let spec: unknown
  try {
    const raw = readFileSync(specPath, 'utf8')
    spec = source.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)
  } catch (err) {
    issues.push({ severity: 'error', message: `OpenAPI spec is not valid ${source.endsWith('.json') ? 'JSON' : 'YAML'}: ${(err as Error).message}`, file: source })
    return
  }
  const s = spec as Record<string, unknown>
  if (typeof s?.openapi !== 'string' && typeof s?.swagger !== 'string') {
    issues.push({ severity: 'error', message: 'OpenAPI spec is missing the "openapi" (or "swagger") version field', file: source })
  }
  if (typeof s?.info !== 'object' || s.info === null) {
    issues.push({ severity: 'error', message: 'OpenAPI spec is missing the "info" object', file: source })
  }
  const paths = s?.paths
  if (typeof paths !== 'object' || paths === null) {
    issues.push({ severity: 'error', message: 'OpenAPI spec is missing the "paths" object', file: source })
  } else {
    const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'])
    for (const [p, ops] of Object.entries(paths as Record<string, unknown>)) {
      if (typeof ops !== 'object' || ops === null) {
        issues.push({ severity: 'error', message: `OpenAPI path "${p}" is not an object`, file: source })
        continue
      }
      const hasOp = Object.keys(ops as Record<string, unknown>).some((k) => methods.has(k.toLowerCase()))
      if (!hasOp) {
        issues.push({ severity: 'warning', message: `OpenAPI path "${p}" has no operations`, file: source })
      }
    }
  }
}

export async function runCheck(projectDir: string, options: CheckOptions): Promise<number> {
  const { fix, ci } = options

  if (!existsSync(join(projectDir, 'docs.json'))) {
    console.error(`\n  ❌ Not a Thally project: docs.json not found in ${projectDir}\n`)
    return 1
  }

  const contentDir = join(projectDir, 'src', 'content')
  const issues: LintIssue[] = []
  const config = readDocsJson(projectDir)

  const navPageIds = new Set<string>()
  const duplicates = new Set<string>()

  for (const tab of config.tabs) {
    if (tab.href) {
      // A standalone href tab (e.g. Changelog) references a real page — not an orphan.
      if (tab.href.startsWith('/')) navPageIds.add(tab.href.slice(1) || 'introduction')
      continue
    }
    if (tab.api) continue
    if (!tab.groups || tab.groups.length === 0) {
      issues.push({ severity: 'error', message: `Tab "${tab.tab}" has no groups and no href — it will render empty` })
      continue
    }
    collectNavPageIds(tab.groups.map((g) => g as unknown as string | DocsJsonNavigationGroup), navPageIds, duplicates)
  }

  for (const dup of duplicates) {
    issues.push({ severity: 'error', message: `[duplicate] "${dup}" appears more than once in docs.json` })
  }

  for (const pageId of navPageIds) {
    const candidates = [join(contentDir, `${pageId}.mdx`), join(contentDir, `${pageId}/index.mdx`)]
    if (!candidates.some((c) => existsSync(c))) {
      issues.push({ severity: 'error', message: `"${pageId}" is in docs.json but has no MDX file`, file: `src/content/${pageId}.mdx` })
    }
  }

  const allFiles: string[] = []
  if (existsSync(contentDir)) scanMdx(contentDir, allFiles)

  const fixedOrphans: string[] = []
  const validPaths = new Set<string>(['/'])
  const anchorsByPath = new Map<string, Set<string>>()
  const linksByFile: Array<{ file: string; path: string; anchors: Set<string>; links: FoundLink[]; offset: number }> = []

  for (const filePath of allFiles) {
    const rel = filePath.slice(contentDir.length + 1).replace(/\.mdx$/, '').replace(/\\/g, '/')
    const pageId = rel.endsWith('/index') ? rel.slice(0, -6) : rel

    if (!navPageIds.has(pageId)) {
      if (fix) {
        addOrphanToNav(projectDir, pageId)
        fixedOrphans.push(pageId)
      } else {
        issues.push({ severity: 'warning', message: `"${pageId}" is not in docs.json nav (orphan)`, file: relative(projectDir, filePath) })
      }
    }

    let data: Record<string, unknown> = {}
    let content = ''
    let lineOffset = 0
    try {
      const raw = readFileSync(filePath, 'utf8')
      const parsed = matter(raw)
      data = parsed.data
      content = parsed.content
      // Links/anchors are found in `content` (frontmatter stripped); offset the
      // reported line numbers back to the raw file so CI annotations land right.
      lineOffset = raw.slice(0, raw.indexOf(content)).split('\n').length - 1
    } catch {
      issues.push({ severity: 'error', message: `Could not parse frontmatter`, file: relative(projectDir, filePath) })
      continue
    }

    const rel2 = relative(projectDir, filePath)
    if (!data.title) issues.push({ severity: 'warning', message: `Missing "title" in frontmatter`, file: rel2 })
    if (!data.description) issues.push({ severity: 'warning', message: `Missing "description" in frontmatter`, file: rel2 })
    if (content.trim().length < 50) issues.push({ severity: 'warning', message: `Very short body (${content.trim().length} chars) — page may be empty`, file: rel2 })

    if (options.drift) checkDrift(projectDir, rel2, data, issues)

    const path = pageIdToPath(pageId)
    const anchors = extractHeadingAnchors(content)
    validPaths.add(path)
    anchorsByPath.set(path, anchors)
    linksByFile.push({ file: rel2, path, anchors, links: extractLinks(content), offset: lineOffset })
  }

  // Broken internal link + anchor detection (after all valid paths are known).
  for (const { file, anchors, links, offset } of linksByFile) {
    for (const { target, line: contentLine } of links) {
      const line = contentLine + offset
      if (/^(https?:|mailto:|tel:)/i.test(target)) continue // external — skipped unless --external
      if (target.startsWith('#')) {
        const anchor = target.slice(1)
        if (anchor && !anchors.has(anchor)) {
          issues.push({ severity: 'warning', message: `Broken anchor: "${target}" not found on this page`, file, line })
        }
        continue
      }
      if (!target.startsWith('/')) continue // relative/asset links — not validated
      const [beforeHash, anchor] = target.split('#')
      let path = beforeHash.split('?')[0] // strip query string
      if (path.length > 1) path = path.replace(/\/$/, '')
      if (path.startsWith('/api') || path.startsWith('/_next') || /\.[a-z0-9]+$/i.test(path)) continue // generated/assets
      if (!validPaths.has(path)) {
        issues.push({ severity: 'error', message: `Broken link: "${target}" — no page at "${path}"`, file, line })
      } else if (anchor && !anchorsByPath.get(path)?.has(anchor)) {
        issues.push({ severity: 'warning', message: `Broken anchor: "${target}" — no heading "#${anchor}" on that page`, file, line })
      }
    }
  }

  // OpenAPI validation for each API tab.
  for (const tab of config.tabs) {
    if (tab.api?.source) validateOpenApi(projectDir, tab.api.source, issues)
  }

  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')

  if (ci) {
    // GitHub Actions annotations (::error / ::warning), then a compact summary.
    for (const issue of issues) {
      const loc = issue.file ? `file=${issue.file}${issue.line ? `,line=${issue.line}` : ''}` : ''
      console.log(`::${issue.severity} ${loc}::${issue.message}`)
    }
    console.log(`\nthally check: ${errors.length} error(s), ${warnings.length} warning(s)`)
    return errors.length > 0 ? 1 : 0
  }

  console.log(`\n  Linting ${projectDir}...\n`)
  if (errors.length === 0 && warnings.length === 0 && fixedOrphans.length === 0) {
    console.log('  ✅ No issues found.\n')
    return 0
  }
  console.log(`  ❌ ${errors.length} error${errors.length !== 1 ? 's' : ''}, ⚠️  ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}\n`)

  if (errors.length > 0) {
    console.log('  ERRORS:')
    for (const issue of errors) {
      console.log(`    ${issue.message}`)
      if (issue.file) console.log(`    → ${issue.file}${issue.line ? `:${issue.line}` : ''}`)
    }
    console.log('')
  }
  if (warnings.length > 0) {
    console.log('  WARNINGS:')
    for (const issue of warnings) {
      console.log(`    ${issue.message}`)
      if (issue.file) console.log(`    → ${issue.file}${issue.line ? `:${issue.line}` : ''}`)
    }
    console.log('')
  }
  if (fixedOrphans.length > 0) {
    console.log(`  ✅ Auto-fixed ${fixedOrphans.length} orphan page${fixedOrphans.length > 1 ? 's' : ''} (added to nav):`)
    for (const p of fixedOrphans) console.log(`    + ${p}`)
    console.log('')
  }
  if (!fix && warnings.some((w) => w.message.includes('orphan'))) {
    console.log('  Tip: run with --fix to auto-add orphan pages to navigation.\n')
  }

  return errors.length > 0 ? 1 : 0
}
