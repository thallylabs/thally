import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ImportedPage } from './importer.js'
import type { DocsJsonConfig, DocsJsonNavigationGroup, DocsJsonTab } from '../docs-json.js'

export type { DocsJsonConfig }

function titleCase(str: string): string {
  return str
    .split('-')
    .map((word) => {
      if (word.toLowerCase() === 'api') return 'API'
      if (word.toLowerCase() === 'sdk') return 'SDK'
      if (word.toLowerCase() === 'cli') return 'CLI'
      if (word.toLowerCase() === 'ui') return 'UI'
      if (word.toLowerCase() === 'faq') return 'FAQ'
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

export function buildNavStructure(pages: ImportedPage[]): DocsJsonConfig {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const p of pages) {
    if (!seen.has(p.pageId)) {
      seen.add(p.pageId)
      ordered.push(p.pageId)
    }
  }

  const depth1Segments = new Set<string>()
  for (const id of ordered) {
    const parts = id.split('/')
    if (parts.length > 1) {
      depth1Segments.add(parts[0])
    }
  }

  const rootOnlyPages = ordered.filter((id) => !id.includes('/'))
  const useSingleTab =
    depth1Segments.size === 0 ||
    (depth1Segments.size === 1 && rootOnlyPages.length === 0)

  let tabs: DocsJsonConfig['tabs']

  if (useSingleTab) {
    const groups = buildGroups(ordered, null)
    tabs = [{ tab: 'Overview', groups }]
  } else {
    tabs = []

    if (rootOnlyPages.length > 0) {
      const groups = buildGroups(rootOnlyPages, null)
      tabs.push({ tab: 'Overview', groups })
    }

    for (const seg of depth1Segments) {
      const tabPages = ordered.filter((id) => id.startsWith(seg + '/') || id === seg)
      const groups = buildGroups(tabPages, seg)
      tabs.push({ tab: titleCase(seg), groups })
    }
  }

  tabs.push({ tab: 'Changelog', href: '/changelog' })

  return { tabs }
}

function buildGroups(
  pageIds: string[],
  tabSegment: string | null,
): NonNullable<DocsJsonTab['groups']> {
  const groupMap = new Map<string, string[]>()

  for (const id of pageIds) {
    let groupName: string

    if (tabSegment === null) {
      groupName = 'Overview'
    } else {
      const rel = id.startsWith(tabSegment + '/') ? id.slice(tabSegment.length + 1) : id
      const relParts = rel.split('/')
      groupName = relParts.length === 1 ? titleCase(tabSegment) : titleCase(relParts[0])
    }

    if (!groupMap.has(groupName)) groupMap.set(groupName, [])
    groupMap.get(groupName)!.push(id)
  }

  const groups = []

  for (const [groupName, groupPages] of groupMap) {
    const sorted = [...groupPages]
    const introIdx = sorted.indexOf('introduction')
    if (introIdx > 0) {
      sorted.splice(introIdx, 1)
      sorted.unshift('introduction')
    }
    groups.push({ group: groupName, pages: sorted })
  }

  return groups
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

export type DocsPlatform =
  | 'mintlify'
  | 'docusaurus'
  | 'gitbook'
  | 'nextra'
  | 'vitepress'
  | 'starlight'
  | 'dox'
  | 'unknown'

export function detectPlatform(cloneDir: string): DocsPlatform {
  if (existsSync(join(cloneDir, 'mint.json'))) return 'mintlify'
  if (existsSync(join(cloneDir, 'docs.json'))) {
    try {
      const parsed = JSON.parse(readFileSync(join(cloneDir, 'docs.json'), 'utf8')) as Record<string, unknown>
      if (Array.isArray(parsed.tabs)) return 'dox'
      const schema = parsed.$schema as string | undefined
      if (schema?.includes('mintlify') || 'navigation' in parsed) return 'mintlify'
    } catch { /* ignore */ }
  }
  if (
    existsSync(join(cloneDir, 'docusaurus.config.js')) ||
    existsSync(join(cloneDir, 'docusaurus.config.ts')) ||
    existsSync(join(cloneDir, 'docusaurus.config.mjs'))
  ) return 'docusaurus'
  if (existsSync(join(cloneDir, 'SUMMARY.md'))) return 'gitbook'
  if (existsSync(join(cloneDir, '.vitepress'))) return 'vitepress'
  if (
    existsSync(join(cloneDir, 'astro.config.mjs')) ||
    existsSync(join(cloneDir, 'astro.config.ts'))
  ) return 'starlight'
  if (
    existsSync(join(cloneDir, '_meta.json')) ||
    existsSync(join(cloneDir, 'pages', '_meta.json'))
  ) return 'nextra'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function normalizePageRef(ref: string, docsDir: string): string {
  let r = ref
  if (docsDir && r.startsWith(docsDir + '/')) r = r.slice(docsDir.length + 1)
  r = r.replace(/\.(mdx?|rst|txt)$/, '')
  const parts = r.split('/')
  const last = parts[parts.length - 1].toLowerCase()
  if (last === 'index' || last === 'readme') {
    return parts.length === 1 ? 'introduction' : parts.slice(0, -1).map(slugify).join('/')
  }
  return parts.map(slugify).join('/')
}

// ---------------------------------------------------------------------------
// Mintlify parser (v1 mint.json, v2 mint.json, v3 docs.json)
// ---------------------------------------------------------------------------

function convertMintTabs(tabs: unknown[], docsDir: string): DocsJsonConfig | null {
  if (tabs.length === 0) return null

  function convertPageRef(page: unknown): string | DocsJsonNavigationGroup {
    if (typeof page === 'string') return normalizePageRef(page, docsDir)
    if (page !== null && typeof page === 'object' && 'group' in page && 'pages' in page) {
      const p = page as Record<string, unknown>
      return {
        group: String(p.group),
        pages: ((p.pages as unknown[]) ?? []).map(convertPageRef),
      }
    }
    return String(page)
  }

  const resultTabs: DocsJsonConfig['tabs'] = (tabs as Record<string, unknown>[]).map((item) => {
    if (item.href) return { tab: String(item.tab), href: String(item.href) }
    const groups = ((item.groups ?? []) as Record<string, unknown>[]).map((g) => ({
      group: String(g.group),
      pages: ((g.pages ?? []) as unknown[]).map(convertPageRef),
    }))
    return { tab: String(item.tab), groups }
  })

  if (!resultTabs.some((t) => t.tab === 'Changelog')) {
    resultTabs.push({ tab: 'Changelog', href: '/changelog' })
  }
  return { tabs: resultTabs }
}

function parseMintConfig(config: Record<string, unknown>, docsDir: string): DocsJsonConfig | null {
  const nav = config.navigation
  if (nav && typeof nav === 'object' && !Array.isArray(nav)) {
    const v3Tabs = (nav as Record<string, unknown>).tabs
    if (Array.isArray(v3Tabs) && v3Tabs.length > 0) return convertMintTabs(v3Tabs, docsDir)
  }
  if (!Array.isArray(nav) || nav.length === 0) return null
  if ('tab' in (nav[0] as Record<string, unknown>)) return convertMintTabs(nav, docsDir)

  function convertPageRef(page: unknown): string | DocsJsonNavigationGroup {
    if (typeof page === 'string') return normalizePageRef(page, docsDir)
    if (page !== null && typeof page === 'object' && 'group' in page && 'pages' in page) {
      const p = page as Record<string, unknown>
      return { group: String(p.group), pages: ((p.pages as unknown[]) ?? []).map(convertPageRef) }
    }
    return String(page)
  }
  const groups = (nav as Record<string, unknown>[]).map((item) => ({
    group: String(item.group ?? ''),
    pages: ((item.pages ?? []) as unknown[]).map(convertPageRef),
  }))
  return { tabs: [{ tab: 'Docs', groups }, { tab: 'Changelog', href: '/changelog' }] }
}

// ---------------------------------------------------------------------------
// GitBook parser (SUMMARY.md)
// ---------------------------------------------------------------------------

function parseGitBookSummary(cloneDir: string, docsDir: string): DocsJsonConfig | null {
  const candidates = [join(cloneDir, 'SUMMARY.md')]
  if (docsDir) candidates.push(join(cloneDir, docsDir, 'SUMMARY.md'))

  let raw = ''
  for (const p of candidates) {
    if (existsSync(p)) { raw = readFileSync(p, 'utf8'); break }
  }
  if (!raw) return null

  const groups: DocsJsonNavigationGroup[] = []
  let currentGroupName = 'Overview'
  let currentPages: (string | DocsJsonNavigationGroup)[] = []

  for (const line of raw.split('\n')) {
    const groupMatch = line.match(/^##\s+(.+)/)
    if (groupMatch) {
      if (currentPages.length > 0) groups.push({ group: currentGroupName, pages: currentPages })
      currentGroupName = groupMatch[1].trim()
      currentPages = []
      continue
    }
    const pageMatch = line.match(/^\*\s+\[.+?\]\((.+?)\)/)
    if (pageMatch) {
      const ref = pageMatch[1].trim()
      if (ref.startsWith('http')) continue
      currentPages.push(normalizePageRef(ref, docsDir))
    }
  }

  if (currentPages.length > 0) groups.push({ group: currentGroupName, pages: currentPages })
  if (groups.length === 0) return null

  return { tabs: [{ tab: 'Docs', groups }, { tab: 'Changelog', href: '/changelog' }] }
}

// ---------------------------------------------------------------------------
// Nextra parser (_meta.json)
// ---------------------------------------------------------------------------

function parseNextraMeta(cloneDir: string, docsDir: string): DocsJsonConfig | null {
  const baseDir = docsDir ? join(cloneDir, docsDir) : cloneDir
  const metaPath = join(baseDir, '_meta.json')
  if (!existsSync(metaPath)) return null

  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>
    const pages: (string | DocsJsonNavigationGroup)[] = []

    for (const [key, value] of Object.entries(meta)) {
      if (typeof value === 'object' && value !== null) {
        const v = value as Record<string, unknown>
        if (v.type === 'separator' || v.type === 'menu') continue
      }
      pages.push(key === 'index' ? 'introduction' : slugify(key))
    }

    if (pages.length === 0) return null
    return {
      tabs: [
        { tab: 'Docs', groups: [{ group: 'Overview', pages }] },
        { tab: 'Changelog', href: '/changelog' },
      ],
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Main detection entry point
// ---------------------------------------------------------------------------

const PLATFORM_LABELS: Record<DocsPlatform, string> = {
  mintlify: 'Mintlify',
  docusaurus: 'Docusaurus',
  gitbook: 'GitBook',
  nextra: 'Nextra',
  vitepress: 'VitePress',
  starlight: 'Starlight (Astro)',
  dox: 'Dox',
  unknown: 'unknown',
}

export function detectNavFromConfig(
  cloneDir: string,
  docsDir: string,
  platform?: DocsPlatform,
): DocsJsonConfig | null {
  const detected = platform ?? detectPlatform(cloneDir)
  const label = PLATFORM_LABELS[detected]

  switch (detected) {
    case 'dox': {
      try {
        const parsed = JSON.parse(
          readFileSync(join(cloneDir, 'docs.json'), 'utf8'),
        ) as DocsJsonConfig
        console.log(`  📋 Detected ${label} — using docs.json navigation as-is`)
        return parsed
      } catch {
        return null
      }
    }

    case 'mintlify': {
      for (const file of ['docs.json', 'mint.json']) {
        const p = join(cloneDir, file)
        if (!existsSync(p)) continue
        try {
          const config = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
          const nav = parseMintConfig(config, docsDir)
          if (nav) {
            console.log(`  📋 Detected ${label} (${file}) — converting navigation`)
            return nav
          }
        } catch { /* ignore */ }
      }
      return null
    }

    case 'gitbook': {
      const nav = parseGitBookSummary(cloneDir, docsDir)
      if (nav) console.log(`  📋 Detected ${label} (SUMMARY.md) — converting navigation`)
      return nav
    }

    case 'nextra': {
      const nav = parseNextraMeta(cloneDir, docsDir)
      if (nav) console.log(`  📋 Detected ${label} (_meta.json) — converting navigation`)
      return nav
    }

    case 'docusaurus':
    case 'vitepress':
    case 'starlight':
      console.log(`  📋 Detected ${label} — nav config is JavaScript, using directory structure`)
      return null

    default:
      return null
  }
}
