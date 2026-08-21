import type { ComponentType } from 'react'
import { getContentIndex, loadContentIndex, type ContentIndex } from '@/lib/content-index'
import { parseFrontmatter } from '@/lib/frontmatter'
import { listRuntimeSources, readRuntimeSource, runtimeSourceExists } from '@/lib/runtime-sources'
import { getDocsJsonConfig, getDocsJsonConfigRevision } from '@/lib/docs-json-config'

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
  /** Set false when authored MDX groups already provide API navigation. */
  navigation?: boolean
  tagsOrder?: Array<string>
  defaultGroup?: string
  webhookGroup?: string
  overrides?: Record<
    string,
    {
      title?: string
      description?: string
      badge?: string
      group?: string
      slug?: Array<string>
      hidden?: boolean
    }
  >
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
  /** Banner copy, or locale-keyed copy resolved against the default locale. */
  content: string | Record<string, string>
  dismissible?: boolean
  /** Stable identity used to scope dismissal state across banner revisions. */
  id?: string
  /** Change this value to show a previously dismissed banner again. */
  revision?: string
  /** Mintlify-compatible intent name. */
  type?: 'info' | 'warning' | 'critical'
  variant?: 'info' | 'warning' | 'critical'
  /** Optional, validated hex colors for the light and dark banner surfaces. */
  color?: { light?: string; dark?: string }
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
  /** POST endpoint for ratings and optional negative follow-ups. */
  endpoint?: string
  /** Show thumbs up/down widget. Defaults to true. */
  thumbsRating?: boolean
}

export type StructuralTheme = 'default' | 'maple' | 'sharp' | 'minimal'
export type ContentIconTone = 'neutral' | 'accent'

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
  /** Visual choices that remain independent of the structural theme. */
  appearance?: {
    /** Card and tile icons are neutral by default or inherit the live brand accent. */
    contentIcons?: ContentIconTone
  }
  /**
   * Structural theme controlling border radius, sidebar active style, and nav
   * tab appearance. Independent of brand colors.
   * Values: "default" | "maple" | "sharp" | "minimal"
   */
  theme?: StructuralTheme
  ai?: {
    chat?: boolean
    /** Label shown in the navbar assistant button and chat header. Defaults to "Ask AI". */
    label?: string
    /**
     * Icon shown in the chat panel. Either a named icon ("sparkles" | "zap" | "bot" |
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
  /** Built-in analytics dashboard at /admin (requires THALLY_ADMIN_PASSWORD env). */
  admin?: {
    enabled?: boolean
  }
  analytics?: {
    enabled?: boolean
  }
  /** Optional public Markdown mirrors at `/<page>.md`; disabled by default. */
  markdown?: {
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
   * Thally Track — product repos whose MERGED PRs should trigger docs-agent PRs.
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
  /** Base branch PRs must merge into to trigger. Defaults to "main". */
  branch?: string
  /** Path globs — only PRs touching these trigger docs tasks. Absent = all. */
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

const CONTENT_ROOT = 'src/content'
let observedDocsConfigRevision = -1

interface FrontmatterData {
  title?: string
  /** Optional compact label used only in sidebar and previous/next navigation. */
  navTitle?: string
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

function docsConfig(): DocsJsonConfig {
  const config = getDocsJsonConfig<DocsJsonConfig>()
  const revision = getDocsJsonConfigRevision()
  if (revision !== observedDocsConfigRevision) {
    observedDocsConfigRevision = revision
    _allEntries = null
    loadedEntriesPromise = null
    sidebarCollectionsCache.clear()
  }
  return config
}

function frontmatterCandidates(pageId: string, locale?: string): Array<string> {
  const candidates: Array<string> = []
  if (locale) {
    candidates.push(`${CONTENT_ROOT}/${locale}/${pageId}.mdx`, `${CONTENT_ROOT}/${locale}/${pageId}/index.mdx`)
  }
  candidates.push(`${CONTENT_ROOT}/${pageId}.mdx`, `${CONTENT_ROOT}/${pageId}/index.mdx`)
  return candidates
}

function readFrontmatter(pageId: string, locale?: string): FrontmatterData {
  const cacheKey = locale ? `${locale}:${pageId}` : pageId
  if (frontmatterCache.has(cacheKey)) {
    return frontmatterCache.get(cacheKey)!
  }

  const candidates = frontmatterCandidates(pageId, locale)

  // A runtime content index answers frontmatter directly and is authoritative
  // when present: the index describes the content this release actually
  // serves, while the compiled sources describe whatever this bundle was
  // built from. The two diverge after every content publish that skipped a
  // build, and falling through to the compiled copy here would pin nav
  // titles and descriptions to the stale build (or, under a shared bundle,
  // to another site's content entirely).
  const index = getContentIndex()
  if (index) {
    for (const filePath of candidates) {
      const entry = index.pages[filePath]
      if (entry) {
        frontmatterCache.set(cacheKey, entry.data as FrontmatterData)
        return entry.data as FrontmatterData
      }
    }
    frontmatterCache.set(cacheKey, {})
    return {}
  }

  for (const filePath of candidates) {
    if (runtimeSourceExists(filePath)) {
      const raw = readRuntimeSource(filePath)
      const { data } = parseFrontmatter(raw)
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
  const clean = pageId.split('/').filter(Boolean).pop()
  if (!clean) {
    return 'Overview'
  }
  return clean.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
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
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'of',
  'for',
  'with',
  'in',
  'on',
  'how',
  'your',
  'you',
  'is',
  'are',
  'using',
  'guide',
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
    const word = source
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    if (word.length >= 2 && !KEYWORD_STOPWORDS.has(word)) words.add(word)
  }
  return Array.from(words).slice(0, 12)
}

function buildDocEntryFromPageId(pageId: string, indexedFrontmatter?: FrontmatterData): DocEntry {
  const fm = indexedFrontmatter ?? readFrontmatter(pageId)
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
  return listRuntimeSources(CONTENT_ROOT)
    .filter((filePath) => filePath.endsWith('.mdx'))
    .map((filePath) => filePath.slice(`${CONTENT_ROOT}/`.length, -'.mdx'.length))
    .filter((relativePath) => !localeCodes.has(relativePath.split('/')[0] ?? ''))
    .map((relativePath) => (relativePath.endsWith('/index') ? relativePath.slice(0, -'/index'.length) : relativePath))
    .filter(Boolean)
}

function getAllDocEntries(): Array<DocEntry> {
  const config = docsConfig()
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
  for (const tab of config.tabs) {
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
  for (const tab of docsConfig().tabs) {
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

let loadedEntriesPromise: Promise<Array<DocEntry>> | null = null
let hydratedContentIndex: ContentIndex | null = null

function hydrateContentIndex(index: ContentIndex): void {
  if (hydratedContentIndex === index) return
  hydratedContentIndex = index
  // These caches may have been populated during module initialisation before
  // a request could fetch the large asset-backed index. Rebuild them once,
  // using the authoritative release frontmatter now cached by content-index.
  frontmatterCache.clear()
  _allEntries = null
  sidebarCollectionsCache.clear()
}

function defaultLocalePageIds(index: ContentIndex): Array<string> {
  const localeCodes = new Set((getI18nConfig()?.locales ?? []).map((locale) => locale.code))
  return Object.keys(index.pages)
    .filter((filePath) => filePath.startsWith(`${CONTENT_ROOT}/`) && filePath.endsWith('.mdx'))
    .map((filePath) => filePath.slice(`${CONTENT_ROOT}/`.length, -'.mdx'.length))
    .filter((relativePath) => !localeCodes.has(relativePath.split('/')[0] ?? ''))
    .map((relativePath) => (relativePath.endsWith('/index') ? relativePath.slice(0, -'/index'.length) : relativePath))
    .filter(Boolean)
}

function indexedFrontmatter(index: ContentIndex, pageId: string): FrontmatterData {
  for (const filePath of frontmatterCandidates(pageId)) {
    const entry = index.pages[filePath]
    if (entry) return entry.data as FrontmatterData
  }
  return {}
}

/**
 * Request-time doc enumeration backed by the immutable content index asset.
 * The synchronous API remains unchanged for local/build consumers; managed
 * routes use this async twin when the index is too large for a text binding.
 */
export function loadDocEntries(): Promise<Array<DocEntry>> {
  docsConfig()
  if (loadedEntriesPromise) return loadedEntriesPromise
  loadedEntriesPromise = (async () => {
    const index = await loadContentIndex()
    if (!index) return getDocEntries()
    hydrateContentIndex(index)
    const seen = new Set<string>()
    const ids: Array<string> = []
    const add = (id: string) => {
      if (!id || seen.has(id)) return
      seen.add(id)
      ids.push(id)
    }
    for (const tab of docsConfig().tabs) {
      if (tab.groups) {
        for (const id of collectPageIds(tab.groups)) add(id)
      } else if (tab.href?.startsWith('/')) {
        add(tab.href.slice(1) || 'introduction')
      }
    }
    for (const id of defaultLocalePageIds(index)) add(id)
    return ids.map((id) => buildDocEntryFromPageId(id, indexedFrontmatter(index, id)))
  })()
  return loadedEntriesPromise
}

export function getDocEntryBySlug(slugPath: string): DocEntry | null
export function getDocEntryBySlug(languageCode: string, slugPath: string): DocEntry | null
export function getDocEntryBySlug(first: string, second?: string): DocEntry | null {
  const slugPath = second !== undefined ? second : first
  const entries = getAllDocEntries()
  return entries.find((doc) => doc.slug.join('/') === slugPath) ?? null
}

/** Async managed-release twin of {@link getDocEntryBySlug}. */
export async function loadDocEntryBySlug(first: string, second?: string): Promise<DocEntry | null> {
  const slugPath = second !== undefined ? second : first
  return (await loadDocEntries()).find((doc) => doc.slug.join('/') === slugPath) ?? null
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
  const href = locale ? (baseHref === '/' ? `/${locale}` : `/${locale}${baseHref}`) : baseHref
  return {
    id: slugifyId(pageId) || 'introduction',
    title: fm.navTitle ?? fm.title ?? deriveTitleFromSlug(pageId),
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
  const config = docsConfig()
  const cacheKey = locale ?? '__default__'
  if (sidebarCollectionsCache.has(cacheKey)) {
    return sidebarCollectionsCache.get(cacheKey)!
  }

  const collections = config.tabs
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

/**
 * Request-time navigation backed by the release index asset when the index is
 * too large for a Worker text binding.
 */
export async function loadSidebarCollections(locale?: string): Promise<Array<SidebarCollection>> {
  const index = await loadContentIndex()
  if (index) hydrateContentIndex(index)
  return getSidebarCollections(locale)
}

// ---------------------------------------------------------------------------
// Prev / Next navigation
// ---------------------------------------------------------------------------

export interface PrevNextLink {
  title: string
  href: string
}

export function getPrevNextLinks(currentHref: string): {
  prev: PrevNextLink | null
  next: PrevNextLink | null
} {
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
        // Group level (section title may contain " • " for nested groups).
        // A group named after its tab (e.g. "Get started" › "Get started")
        // would stutter — collapse consecutive duplicate labels.
        const groupParts = section.title.split(' • ')
        for (const part of groupParts) {
          if (crumbs[crumbs.length - 1]?.label !== part) crumbs.push({ label: part })
        }
        // Current page
        crumbs.push({ label: match.title })
        return crumbs
      }
    }
  }

  return []
}

/**
 * The page's nearest navigation group — the "category" shown as an eyebrow
 * above the page title. Derived from the docs.json navigation model (never
 * from per-page frontmatter) so it stays correct across tabs, nested groups
 * and locales: group labels are single-sourced from docs.json, which also
 * guarantees the eyebrow is identical in every locale. Returns null for pages
 * that sit outside any navigation group (e.g. direct-link tabs).
 */
export function getNavCategory(currentHref: string): string | null {
  for (const collection of getSidebarCollections()) {
    for (const section of collection.sections) {
      if (section.items.some((item) => item.href === currentHref)) {
        // Nested groups join ancestors with " • " — the leaf group is the category.
        const parts = section.title.split(' • ')
        return parts[parts.length - 1] || null
      }
    }
  }
  return null
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

/** Async managed-release twin of {@link getNavContext}. */
export async function loadNavContext(pageId: string): Promise<NavContext> {
  const index = await loadContentIndex()
  if (index) hydrateContentIndex(index)
  return getNavContext(pageId)
}

export function getAiConfig(): {
  chat?: boolean
  label?: string
  icon?: string
  systemPrompt?: string
} {
  return docsConfig().ai ?? {}
}

export function getApiPlaygroundCredentials(): Record<string, string> {
  return docsConfig().apiPlayground?.credentials ?? {}
}

export function isAnalyticsEnabled(): boolean {
  return docsConfig().analytics?.enabled !== false
}

export function isAdminDashboardEnabled(): boolean {
  return docsConfig().admin?.enabled !== false
}

export function getI18nConfig(): {
  defaultLocale: string
  locales: Array<{ code: string; label: string }>
} | null {
  return docsConfig().i18n ?? null
}

/** The git-committed admin team roster (C1). Always returns arrays. */
export function getTeamConfig(): TeamConfig {
  return {
    members: docsConfig().team?.members ?? [],
    domains: docsConfig().team?.domains ?? [],
  }
}

/** The git-committed Thally Track roster. Always returns an array. */
export function getTrackingConfig(): TrackingConfig {
  return { repos: docsConfig().tracking?.repos ?? [] }
}

export function getBannerConfig(): DocsJsonBanner | null {
  const candidate = docsConfig().banner as unknown
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
  const raw = candidate as Record<string, unknown>
  let content: string | Record<string, string> | null = null
  if (typeof raw.content === 'string' && raw.content.trim()) {
    content = raw.content
  } else if (raw.content && typeof raw.content === 'object' && !Array.isArray(raw.content)) {
    const localized = Object.fromEntries(
      Object.entries(raw.content).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()),
      ),
    )
    if (Object.keys(localized).length > 0) content = localized
  }
  if (!content) return null

  const intent = raw.type === 'info' || raw.type === 'warning' || raw.type === 'critical'
    ? raw.type
    : raw.variant === 'info' || raw.variant === 'warning' || raw.variant === 'critical'
      ? raw.variant
      : undefined
  const rawColor = raw.color && typeof raw.color === 'object' && !Array.isArray(raw.color)
    ? raw.color as Record<string, unknown>
    : null
  const color = rawColor
    ? {
        light: typeof rawColor.light === 'string' ? rawColor.light : undefined,
        dark: typeof rawColor.dark === 'string' ? rawColor.dark : undefined,
      }
    : undefined

  return {
    content,
    dismissible: typeof raw.dismissible === 'boolean' ? raw.dismissible : undefined,
    id: typeof raw.id === 'string' ? raw.id : undefined,
    revision: typeof raw.revision === 'string' ? raw.revision : undefined,
    type: intent,
    color,
  }
}

export function getNavbarConfig(): DocsJsonNavbar | null {
  return docsConfig().navbar ?? null
}

export function getFooterConfig(): DocsJsonFooter | null {
  return docsConfig().footer ?? null
}

export function getFeedbackConfig(): DocsJsonFeedback {
  return docsConfig().feedback ?? { thumbsRating: true }
}

export function getFontsConfig(): DocsJsonFonts {
  return docsConfig().fonts ?? {}
}

export function getRedirectsConfig(): Array<DocsJsonRedirect> {
  return docsConfig().redirects ?? []
}

export function getCustomScriptsConfig(): Array<DocsJsonScript> {
  return docsConfig().customScripts ?? []
}

export function getSeoConfig(): DocsJsonSeo {
  return docsConfig().seo ?? {}
}

export function getStructuralTheme(): StructuralTheme {
  return docsConfig().theme ?? 'default'
}

/** Resolve the global card/tile icon treatment, defaulting to quiet neutrals. */
export function getContentIconTone(): ContentIconTone {
  return docsConfig().appearance?.contentIcons === 'accent' ? 'accent' : 'neutral'
}
