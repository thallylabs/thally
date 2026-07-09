import type { ComponentType } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import docsNavigationConfig from '../../docs.json' assert { type: 'json' }

// ---------------------------------------------------------------------------
// Public interfaces (consumed by components, pages, and stores)
// ---------------------------------------------------------------------------

export type DocPageMode = 'default' | 'wide' | 'custom' | 'center' | 'home'

export interface DocEntry {
  id: string
  title: string
  description: string
  slug: Array<string>
  href: string
  group: string
  badge?: string
  keywords: Array<string>
  component: ComponentType<Record<string, unknown>>
  timeEstimate: string
  lastUpdated: string
  /** Public provenance: ISO date a human last confirmed this page is accurate. */
  lastVerified?: string
  /** Public provenance: product version this page was verified against. */
  verifiedVersion?: string
  openapi?: OpenApiReference
  noindex?: boolean
  hidden?: boolean
  mode?: DocPageMode
}

export interface OpenApiReference {
  specId: string
  method: string
  path: string
}

export interface NavigationSection {
  title: string
  icon?: string
  items: Array<NavigationItem>
}

export interface SidebarCollection {
  id: string
  label: string
  sections: Array<NavigationSection>
  href?: string
  api?: DocsJsonApiConfig
}

export interface NavigationItem {
  id: string
  title: string
  href: string
  badge?: string
  description?: string
}

export interface SearchableDoc {
  id: string
  title: string
  description: string
  href: string
  keywords: Array<string>
}

// ---------------------------------------------------------------------------
// docs.json schema types
// ---------------------------------------------------------------------------

interface DocsJsonNavigationGroup {
  group: string
  icon?: string
  hidden?: boolean
  pages: Array<string | DocsJsonNavigationGroup>
}

export interface DocsJsonApiConfig {
  source: string
  tagsOrder?: Array<string>
  defaultGroup?: string
  webhookGroup?: string
  overrides?: Record<string, {
    title?: string
    description?: string
    badge?: string
    group?: string
    slug?: Array<string>
    hidden?: boolean
  }>
}

interface DocsJsonTab {
  tab: string
  href?: string
  hidden?: boolean
  groups?: Array<DocsJsonNavigationGroup>
  api?: DocsJsonApiConfig
}

export interface DocsJsonRedirect {
  source: string
  destination: string
  permanent?: boolean
}

export interface DocsJsonBanner {
  content: string
  dismissible?: boolean
}

export interface DocsJsonNavLink {
  label: string
  href: string
  type?: 'github'
}

export interface DocsJsonNavbar {
  links?: Array<DocsJsonNavLink>
  primary?: { label: string; href: string }
}

export interface DocsJsonFooterColumn {
  heading: string
  items: Array<{ label: string; href: string }>
}

export interface DocsJsonFooter {
  socials?: Record<string, string>
  links?: Array<DocsJsonFooterColumn>
}

export interface DocsJsonSeo {
  /** "navigable" (default) excludes hidden pages; "all" indexes them too */
  indexing?: 'navigable' | 'all'
}

export interface DocsJsonScript {
  src: string
  strategy?: 'beforeInteractive' | 'afterInteractive' | 'lazyOnload'
}

export interface DocsJsonFontConfig {
  /** Google Font family name, e.g. "Plus Jakarta Sans" */
  family: string
  /** Weight values to load, e.g. ["400", "500", "600", "700"]. Defaults to ["400","500","600","700"]. */
  weight?: string[]
}

export interface DocsJsonFonts {
  /** Font applied to body text and the overall UI */
  body?: DocsJsonFontConfig
  /** Font applied to h1–h6 headings. Defaults to the body font when omitted. */
  heading?: DocsJsonFontConfig
}

export interface DocsJsonFeedback {
  /** POST endpoint to receive feedback votes. Request body: { page, vote, url } */
  endpoint?: string
  /** Show thumbs up/down widget. Defaults to true. */
  thumbsRating?: boolean
}

export type StructuralTheme = 'default' | 'maple' | 'sharp' | 'minimal'

interface DocsJsonConfig {
  tabs: Array<DocsJsonTab>
  redirects?: Array<DocsJsonRedirect>
  banner?: DocsJsonBanner
  navbar?: DocsJsonNavbar
  footer?: DocsJsonFooter
  seo?: DocsJsonSeo
  customScripts?: Array<DocsJsonScript>
  fonts?: DocsJsonFonts
  feedback?: DocsJsonFeedback
  /**
   * Structural theme controlling border radius, sidebar active style, and nav
   * tab appearance. Independent of brand colors.
   * Values: "default" | "maple" | "sharp" | "minimal"
   */
  theme?: StructuralTheme
  ai?: {
    chat?: boolean
    /** Label shown on the FAB and in the chat header. Defaults to "Ask AI". */
    label?: string
    /**
     * Icon shown on the FAB. Either a named icon ("sparkles" | "zap" | "bot" |
     * "brain" | "stars" | "wand") or a URL / path to an image (e.g. "/logo.png").
     * Defaults to "sparkles".
     */
    icon?: string
    /** Custom system prompt for the AI assistant. Appended to the docs context instruction. */
    systemPrompt?: string
  }
  /** Credentials applied to the API Try It playground from OpenAPI security scheme names. */
  apiPlayground?: {
    credentials?: Record<string, string>
  }
  /** Built-in analytics dashboard at /admin (requires DOX_ADMIN_PASSWORD env). */
  admin?: {
    enabled?: boolean
  }
  analytics?: {
    enabled?: boolean
  }
  i18n?: {
    defaultLocale: string
    locales: Array<{ code: string; label: string }>
  }
  /**
   * Admin-dashboard team — the git-committed roster (C1). Version-controlled and
   * code-reviewed, so team-mode needs no database, even on serverless. Explicit
   * members win over domain defaults.
   */
  team?: {
    members?: Array<{ email: string; role: 'owner' | 'editor' | 'viewer' }>
    domains?: Array<{ domain: string; role: 'owner' | 'editor' | 'viewer' }>
  }
  /**
   * Dox Track — product repos whose commits should trigger docs-agent PRs.
   * Git-committed like the team roster: adding a repo is a reviewed change.
   */
  tracking?: {
    repos?: Array<TrackingRepoConfig>
  }
}

export interface TeamConfig {
  members: Array<{ email: string; role: 'owner' | 'editor' | 'viewer' }>
  domains: Array<{ domain: string; role: 'owner' | 'editor' | 'viewer' }>
}

export interface TrackingRepoConfig {
  owner: string
  repo: string
  /** Branch to watch. Defaults to "main". */
  branch?: string
  /** Path globs — only commits touching these trigger docs tasks. Absent = all. */
  paths?: Array<string>
  /** Sidebar tab generated pages should land in. */
  outputTab?: string
  /** Group heading within that tab. */
  outputGroup?: string
}

export interface TrackingConfig {
  repos: Array<TrackingRepoConfig>
}

// ---------------------------------------------------------------------------
// Content root & frontmatter cache
// ---------------------------------------------------------------------------

const CONTENT_ROOT = path.join(process.cwd(), 'src/content')
const docsConfig = docsNavigationConfig as unknown as DocsJsonConfig

interface FrontmatterData {
  title?: string
  description?: string
  badge?: string
  keywords?: Array<string>
  timeEstimate?: string
  lastUpdated?: string
  lastVerified?: string
  verifiedVersion?: string
  openapi?: string
  hidden?: boolean
  noindex?: boolean
  mode?: DocPageMode
}

const frontmatterCache = new Map<string, FrontmatterData>()

function readFrontmatter(pageId: string, locale?: string): FrontmatterData {
  const cacheKey = locale ? `${locale}:${pageId}` : pageId
  if (frontmatterCache.has(cacheKey)) {
    return frontmatterCache.get(cacheKey)!
  }

  const candidates: Array<string> = []

  // Try locale-specific file first
  if (locale) {
    candidates.push(
      path.join(CONTENT_ROOT, locale, `${pageId}.mdx`),
      path.join(CONTENT_ROOT, locale, `${pageId}/index.mdx`),
    )
  }

  // Fall back to primary
  candidates.push(
    path.join(CONTENT_ROOT, `${pageId}.mdx`),
    path.join(CONTENT_ROOT, `${pageId}/index.mdx`),
  )

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8')
      const { data } = matter(raw)
      frontmatterCache.set(cacheKey, data as FrontmatterData)
      return data as FrontmatterData
    }
  }

  frontmatterCache.set(cacheKey, {})
  return {}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Placeholder: ComponentType<Record<string, unknown>> = () => null

export function deriveTitleFromSlug(pageId: string) {
  const clean = pageId
    .split('/')
    .filter(Boolean)
    .pop()
  if (!clean) {
    return 'Overview'
  }
  return clean
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function slugifyId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .replace(/\//g, '-')
}

// ---------------------------------------------------------------------------
// Collect all page IDs from docs.json (for static params & search index)
// ---------------------------------------------------------------------------

function collectPageIds(groups: Array<DocsJsonNavigationGroup>): Array<string> {
  const ids: Array<string> = []
  for (const group of groups) {
    for (const page of group.pages) {
      if (typeof page === 'string') {
        ids.push(page)
      } else {
        ids.push(...collectPageIds([page]))
      }
    }
  }
  return ids
}

const KEYWORD_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'with', 'in', 'on', 'how', 'your', 'you', 'is', 'are', 'using', 'guide',
])

/**
 * Mechanical fallback keywords when a page has none in frontmatter — derived
 * from its title and slug path (which mirrors its nav category). Thinner than
 * hand-authored keywords, but real terms about the page: they feed JSON-LD and
 * the ?format=json metadata, and lift agent-retrieval signal for every page,
 * present and future, with no per-page authoring.
 */
function deriveKeywords(title: string, slug: Array<string>): Array<string> {
  const words = new Set<string>()
  const phrase = title.trim().toLowerCase()
  if (phrase) words.add(phrase) // the full title as a phrase
  for (const source of [...slug, ...title.split(/[\s/&,-]+/)]) {
    const word = source.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    if (word.length >= 2 && !KEYWORD_STOPWORDS.has(word)) words.add(word)
  }
  return Array.from(words).slice(0, 12)
}

function buildDocEntryFromPageId(pageId: string): DocEntry {
  const fm = readFrontmatter(pageId)
  const slug = pageId === 'introduction' ? [] : pageId.split('/').filter(Boolean)
  const href = slug.length ? `/${slug.join('/')}` : '/'
  const title = fm.title ?? deriveTitleFromSlug(pageId)
  return {
    id: pageId,
    title,
    description: fm.description ?? '',
    slug,
    href,
    group: '',
    badge: fm.badge,
    keywords: fm.keywords?.length ? fm.keywords : deriveKeywords(title, slug),
    component: Placeholder,
    timeEstimate: fm.timeEstimate ?? '5 min',
    lastUpdated: fm.lastUpdated ?? '',
    lastVerified: fm.lastVerified,
    verifiedVersion: fm.verifiedVersion,
  }
}

// ---------------------------------------------------------------------------
// Build entries from all tabs
// ---------------------------------------------------------------------------

let _allEntries: Array<DocEntry> | null = null

/** Every page that has an .mdx file under src/content (default locale only). */
function getAllContentPageIds(): Array<string> {
  const localeCodes = new Set((getI18nConfig()?.locales ?? []).map((l) => l.code))
  const ids: Array<string> = []
  const walk = (dir: string, prefix: string) => {
    let entries: Array<fs.Dirent>
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (prefix === '' && localeCodes.has(entry.name)) continue // skip translation dirs
        walk(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name)
      } else if (entry.name.endsWith('.mdx')) {
        const base = entry.name.slice(0, -4)
        const id = base === 'index' ? prefix : prefix ? `${prefix}/${base}` : base
        if (id) ids.push(id)
      }
    }
  }
  walk(CONTENT_ROOT, '')
  return ids
}

function getAllDocEntries(): Array<DocEntry> {
  if (_allEntries) return _allEntries

  const seen = new Set<string>()
  const entries: Array<DocEntry> = []
  const add = (id: string) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    entries.push(buildDocEntryFromPageId(id))
  }

  // 1. Nav-group pages first (preserves nav order), plus standalone href tabs
  //    (e.g. Changelog) which reference a real page outside any group.
  for (const tab of docsConfig.tabs) {
    if (tab.groups) {
      for (const id of collectPageIds(tab.groups)) add(id)
    } else if (tab.href && tab.href.startsWith('/')) {
      add(tab.href.slice(1) || 'introduction')
    }
  }

  // 2. Every remaining content page — so search, embeddings, and the agent
  //    endpoints cover the whole site, not just pages listed in a nav group.
  for (const id of getAllContentPageIds()) add(id)

  _allEntries = entries
  return entries
}

/** Page IDs reachable from navigation: nav-group pages + standalone href tabs. */
export function getNavigablePageIds(): Set<string> {
  const ids = new Set<string>()
  for (const tab of docsConfig.tabs) {
    if (tab.groups) {
      for (const id of collectPageIds(tab.groups)) ids.add(id)
    } else if (tab.href && tab.href.startsWith('/')) {
      ids.add(tab.href.slice(1) || 'introduction')
    }
  }
  return ids
}

// ---------------------------------------------------------------------------
// Public query functions
// ---------------------------------------------------------------------------

export function getDocEntries(): Array<DocEntry> {
  return getAllDocEntries()
}

export function getDocEntryBySlug(slugPath: string): DocEntry | null
export function getDocEntryBySlug(languageCode: string, slugPath: string): DocEntry | null
export function getDocEntryBySlug(first: string, second?: string): DocEntry | null {
  const slugPath = second !== undefined ? second : first
  const entries = getAllDocEntries()
  return entries.find((doc) => doc.slug.join('/') === slugPath) ?? null
}

export function getSearchableDocs(): Array<SearchableDoc> {
  return getAllDocEntries().map((doc) => ({
    id: doc.id,
    title: doc.title,
    description: doc.description,
    href: doc.href,
    keywords: doc.keywords,
  }))
}

// ---------------------------------------------------------------------------
// Sidebar construction from docs.json
// ---------------------------------------------------------------------------

function resolveNavItem(pageId: string, locale?: string): NavigationItem {
  const fm = readFrontmatter(pageId, locale)
  const slug = pageId === 'introduction' ? [] : pageId.split('/').filter(Boolean)
  const baseHref = slug.length ? `/${slug.join('/')}` : '/'
  const href = locale
    ? baseHref === '/'
      ? `/${locale}`
      : `/${locale}${baseHref}`
    : baseHref
  return {
    id: slugifyId(pageId) || 'introduction',
    title: fm.title ?? deriveTitleFromSlug(pageId),
    href,
    badge: fm.badge,
    description: fm.description,
  }
}

function buildNavigationSections(
  group: DocsJsonNavigationGroup,
  ancestors: Array<string> = [],
  locale?: string,
): Array<NavigationSection> {
  if (group.hidden) return []

  const titleSegments = [...ancestors, group.group].filter(Boolean)
  const title = titleSegments.length ? titleSegments.join(' • ') : 'General'

  const sections: Array<NavigationSection> = []
  let bufferedItems: Array<NavigationItem> = []

  group.pages.forEach((page) => {
    if (typeof page === 'string') {
      bufferedItems.push(resolveNavItem(page, locale))
      return
    }

    if (bufferedItems.length) {
      sections.push({ title, icon: group.icon, items: bufferedItems })
      bufferedItems = []
    }

    sections.push(...buildNavigationSections(page, titleSegments, locale))
  })

  if (bufferedItems.length) {
    sections.push({ title, icon: group.icon, items: bufferedItems })
  }

  return sections
}

const sidebarCollectionsCache = new Map<string, Array<SidebarCollection>>()

export function getSidebarCollections(locale?: string): Array<SidebarCollection> {
  const cacheKey = locale ?? '__default__'
  if (sidebarCollectionsCache.has(cacheKey)) {
    return sidebarCollectionsCache.get(cacheKey)!
  }

  const collections = docsConfig.tabs
    .filter((tab) => !tab.hidden)
    .map((tab) => {
      const id = slugifyId(tab.tab) || tab.tab.toLowerCase()
      const groups = tab.groups ?? []
      const sections = groups.flatMap((group) => buildNavigationSections(group, [], locale))

      return {
        id,
        label: tab.tab,
        sections,
        href: tab.href,
        api: tab.api,
      }
    })

  sidebarCollectionsCache.set(cacheKey, collections)
  return collections
}

// ---------------------------------------------------------------------------
// Prev / Next navigation
// ---------------------------------------------------------------------------

export interface PrevNextLink {
  title: string
  href: string
}

export function getPrevNextLinks(currentHref: string): { prev: PrevNextLink | null; next: PrevNextLink | null } {
  const collections = getSidebarCollections()
  const flatPages: Array<{ title: string; href: string }> = []

  for (const collection of collections) {
    for (const section of collection.sections) {
      for (const item of section.items) {
        if (!flatPages.some((p) => p.href === item.href)) {
          flatPages.push({ title: item.title, href: item.href })
        }
      }
    }
  }

  const index = flatPages.findIndex((p) => p.href === currentHref)
  if (index === -1) {
    return { prev: null, next: null }
  }

  return {
    prev: index > 0 ? flatPages[index - 1] : null,
    next: index < flatPages.length - 1 ? flatPages[index + 1] : null,
  }
}

// ---------------------------------------------------------------------------
// Breadcrumbs
// ---------------------------------------------------------------------------

export interface BreadcrumbItem {
  label: string
  href?: string
}

export function getBreadcrumbs(currentHref: string): Array<BreadcrumbItem> {
  const collections = getSidebarCollections()

  for (const collection of collections) {
    for (const section of collection.sections) {
      const match = section.items.find((item) => item.href === currentHref)
      if (match) {
        const crumbs: Array<BreadcrumbItem> = []
        // Tab level
        const firstPageHref = collection.sections[0]?.items[0]?.href
        crumbs.push({ label: collection.label, href: firstPageHref })
        // Group level (section title may contain " • " for nested groups)
        const groupParts = section.title.split(' • ')
        for (const part of groupParts) {
          crumbs.push({ label: part })
        }
        // Current page
        crumbs.push({ label: match.title })
        return crumbs
      }
    }
  }

  return []
}

// ---------------------------------------------------------------------------
// Nav context for agent API responses
// ---------------------------------------------------------------------------

export interface NavContext {
  tab: string
  group: string
  prev: PrevNextLink | null
  next: PrevNextLink | null
  breadcrumb: Array<BreadcrumbItem>
}

export function getNavContext(pageId: string): NavContext {
  const slug = pageId === 'introduction' ? [] : pageId.split('/').filter(Boolean)
  const href = slug.length ? `/${slug.join('/')}` : '/'

  const { prev, next } = getPrevNextLinks(href)
  const breadcrumb = getBreadcrumbs(href)

  // Find which tab and group this page belongs to
  const collections = getSidebarCollections()
  let tabName = ''
  let groupName = ''

  outer: for (const collection of collections) {
    for (const section of collection.sections) {
      if (section.items.some((item) => item.href === href)) {
        tabName = collection.label
        // Strip dot-separated ancestors — take the leaf group name
        const parts = section.title.split(' • ')
        groupName = parts[parts.length - 1] ?? section.title
        break outer
      }
    }
  }

  return { tab: tabName, group: groupName, prev, next, breadcrumb }
}

export function getAiConfig(): {
  chat?: boolean
  label?: string
  icon?: string
  systemPrompt?: string
} {
  return docsConfig.ai ?? {}
}

export function getApiPlaygroundCredentials(): Record<string, string> {
  return docsConfig.apiPlayground?.credentials ?? {}
}

export function isAnalyticsEnabled(): boolean {
  return docsConfig.analytics?.enabled !== false
}

export function isAdminDashboardEnabled(): boolean {
  return docsConfig.admin?.enabled !== false
}

export function getI18nConfig(): { defaultLocale: string; locales: Array<{ code: string; label: string }> } | null {
  return docsConfig.i18n ?? null
}

/** The git-committed admin team roster (C1). Always returns arrays. */
export function getTeamConfig(): TeamConfig {
  return {
    members: docsConfig.team?.members ?? [],
    domains: docsConfig.team?.domains ?? [],
  }
}

/** The git-committed Dox Track roster. Always returns an array. */
export function getTrackingConfig(): TrackingConfig {
  return { repos: docsConfig.tracking?.repos ?? [] }
}

export function getBannerConfig(): DocsJsonBanner | null {
  return docsConfig.banner ?? null
}

export function getNavbarConfig(): DocsJsonNavbar | null {
  return docsConfig.navbar ?? null
}

export function getFooterConfig(): DocsJsonFooter | null {
  return docsConfig.footer ?? null
}

export function getFeedbackConfig(): DocsJsonFeedback {
  return docsConfig.feedback ?? { thumbsRating: true }
}

export function getFontsConfig(): DocsJsonFonts {
  return docsConfig.fonts ?? {}
}

export function getRedirectsConfig(): Array<DocsJsonRedirect> {
  return docsConfig.redirects ?? []
}

export function getCustomScriptsConfig(): Array<DocsJsonScript> {
  return docsConfig.customScripts ?? []
}

export function getSeoConfig(): DocsJsonSeo {
  return docsConfig.seo ?? {}
}

export function getStructuralTheme(): StructuralTheme {
  return docsConfig.theme ?? 'default'
}

// ---------------------------------------------------------------------------
// Pre-computed exports for client-side store defaults
// ---------------------------------------------------------------------------

export const sidebarCollections = getSidebarCollections()
export const searchableDocs = getSearchableDocs()

