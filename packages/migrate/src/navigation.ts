/**
 * Navigation projection for imported sites. Mintlify's schema is intentionally
 * more expressive than Thally's tab/group model, so complex containers are
 * flattened predictably while preserving page order and nested groups.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, relative } from 'node:path'

import { pageIdFromReference, resolveWithin } from './path.js'
import type {
  MigrationDocsConfig,
  MigrationNavigationGroup,
  MigrationNavigationTab,
  MigrationPage,
  MigrationWarning,
} from './types.js'

interface MintlifyPageReference {
  ref: string
  navigationId: string
  locale?: string
}

export interface MintlifyNavigationResult {
  docsConfig: MigrationDocsConfig
  pageReferences: Array<MintlifyPageReference>
  warnings: Array<MigrationWarning>
}

const LANGUAGE_LABELS: Record<string, string> = {
  ar: 'Arabic',
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  hi: 'Hindi',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  nl: 'Dutch',
  pl: 'Polish',
  pt: 'Portuguese',
  ru: 'Russian',
  tr: 'Turkish',
  uk: 'Ukrainian',
  zh: 'Chinese',
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function labelFor(value: Record<string, unknown>, fallback: string): string {
  for (const key of ['tab', 'group', 'anchor', 'product', 'dropdown', 'version', 'menu', 'label', 'name', 'title']) {
    if (typeof value[key] === 'string' && value[key]) return String(value[key])
  }
  return fallback
}

function localReference(value: string): string {
  return value.split('#', 1)[0]
}

function jsonPointer(root: unknown, pointer: string): unknown {
  if (!pointer || pointer === '#') return root
  const tokens = pointer.replace(/^#\/?/, '').split('/').filter(Boolean)
  return tokens.reduce<unknown>((current, token) => {
    const object = objectValue(current)
    if (!object) return undefined
    return object[token.replace(/~1/g, '/').replace(/~0/g, '~')]
  }, root)
}

function resolveJsonReferences(
  value: unknown,
  currentFile: string,
  repositoryRoot: string,
  stack: Set<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveJsonReferences(entry, currentFile, repositoryRoot, stack))
  }
  const object = objectValue(value)
  if (!object) return value
  if (typeof object.$ref === 'string') {
    const [filePart, pointer = ''] = object.$ref.split('#', 2)
    const referencedFile = filePart
      ? resolveWithin(dirname(currentFile), filePart)
      : currentFile
    const relativePath = relative(repositoryRoot, referencedFile)
    resolveWithin(repositoryRoot, relativePath)
    const stackKey = `${referencedFile}#${pointer}`
    if (stack.has(stackKey)) throw new Error(`Circular Mintlify $ref: ${object.$ref}`)
    stack.add(stackKey)
    const referencedRoot = JSON.parse(readFileSync(referencedFile, 'utf8')) as unknown
    const referenced = jsonPointer(referencedRoot, pointer ? `#${pointer}` : '')
    const resolved = resolveJsonReferences(referenced, referencedFile, repositoryRoot, stack)
    stack.delete(stackKey)
    return resolved
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, entry]) => [
      key,
      resolveJsonReferences(entry, currentFile, repositoryRoot, stack),
    ]),
  )
}

/** Read `docs.json`/`mint.json`, including bounded local JSON references. */
export function readMintlifyConfig(repositoryRoot: string): Record<string, unknown> | null {
  const configPath = ['docs.json', 'mint.json']
    .map((filename) => resolveWithin(repositoryRoot, filename))
    .find(existsSync)
  if (!configPath) return null
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
  return resolveJsonReferences(raw, configPath, repositoryRoot, new Set()) as Record<string, unknown>
}

function normalizePageRef(value: string): string | null {
  if (/^(?:https?:)?\/\//i.test(value) || value.startsWith('#')) return null
  const ref = localReference(value).replace(/^\/+/, '').replace(/\.(?:mdx?|rst|txt)$/i, '')
  return pageIdFromReference(ref)
}

interface ProjectionContext {
  locale?: string
  references: Array<MintlifyPageReference>
  seenReferences: Set<string>
}

function registerReference(value: string, context: ProjectionContext): string | null {
  const localePrefix = context.locale ? `${context.locale}/` : ''
  const localizedValue = localePrefix && value.replace(/^\/+/, '').startsWith(localePrefix)
    ? value.replace(/^\/+/, '').slice(localePrefix.length)
    : value
  const navigationId = normalizePageRef(localizedValue)
  if (!navigationId) return null
  const key = `${context.locale ?? ''}:${value}`
  if (!context.seenReferences.has(key)) {
    context.seenReferences.add(key)
    context.references.push({ ref: value, navigationId, locale: context.locale })
  }
  return navigationId
}

function convertPage(
  value: unknown,
  context: ProjectionContext,
): string | MigrationNavigationGroup | null {
  if (typeof value === 'string') return registerReference(value, context)
  const object = objectValue(value)
  if (!object) return null
  if (typeof object.page === 'string') return registerReference(object.page, context)
  const pages = Array.isArray(object.pages) ? object.pages : []
  if ('group' in object || pages.length > 0) {
    const children: Array<string | MigrationNavigationGroup> = []
    if (typeof object.root === 'string') {
      const root = registerReference(object.root, context)
      if (root) children.push(root)
    }
    for (const page of pages) {
      const converted = convertPage(page, context)
      if (converted) children.push(converted)
    }
    if (children.length === 0) return null
    return {
      group: labelFor(object, 'Documentation'),
      ...(typeof object.icon === 'string' ? { icon: object.icon } : {}),
      pages: children,
    }
  }
  return null
}

function convertGroups(
  values: Array<unknown>,
  context: ProjectionContext,
  fallbackGroup: string,
): Array<MigrationNavigationGroup> {
  const groups: Array<MigrationNavigationGroup> = []
  const loosePages: Array<string | MigrationNavigationGroup> = []
  for (const value of values) {
    const converted = convertPage(value, context)
    if (!converted) continue
    if (typeof converted === 'string') loosePages.push(converted)
    else groups.push(converted)
  }
  if (loosePages.length > 0) groups.unshift({ group: fallbackGroup, pages: loosePages })
  return groups
}

function convertContainerToTabs(
  containerValue: unknown,
  context: ProjectionContext,
  fallbackTab: string,
): Array<MigrationNavigationTab> {
  const container = objectValue(containerValue)
  if (!container) return []
  for (const key of ['tabs', 'anchors', 'products', 'dropdowns', 'versions', 'menus']) {
    if (!Array.isArray(container[key])) continue
    const tabs = (container[key] as Array<unknown>).flatMap((value, index) => {
      const object = objectValue(value)
      if (!object) return []
      const tab = labelFor(object, `${fallbackTab} ${index + 1}`)
      if (typeof object.href === 'string' && !object.pages && !object.groups) {
        return [{ tab, href: object.href }]
      }
      const nested = convertContainerToTabs(object, context, tab)
      if (nested.length > 0) {
        if (nested.length === 1) return [{ ...nested[0], tab }]
        return nested.map((item) => ({ ...item, tab: `${tab}: ${item.tab}` }))
      }
      return []
    })
    if (tabs.length > 0) return tabs
  }
  const rawPages = [
    ...(Array.isArray(container.groups) ? container.groups : []),
    ...(Array.isArray(container.pages) ? container.pages : []),
  ]
  if (typeof container.root === 'string') rawPages.unshift(container.root)
  const groups = convertGroups(rawPages, context, 'Overview')
  return groups.length > 0 ? [{ tab: fallbackTab, groups }] : []
}

/** Convert current and legacy Mintlify navigation into Thally's schema. */
export function projectMintlifyNavigation(config: Record<string, unknown>): MintlifyNavigationResult {
  const warnings: Array<MigrationWarning> = []
  const references: Array<MintlifyPageReference> = []
  const seenReferences = new Set<string>()
  const navigation = objectValue(config.navigation) ?? config
  const languages = Array.isArray(navigation.languages)
    ? navigation.languages.map(objectValue).filter((value): value is Record<string, unknown> => Boolean(value))
    : []
  let tabs: Array<MigrationNavigationTab> = []
  let i18n: MigrationDocsConfig['i18n']

  if (languages.length > 0) {
    const defaultLanguage = languages.find((entry) => entry.language === 'en') ?? languages[0]
    const defaultLocale = String(defaultLanguage.language ?? 'en')
    const locales = languages.map((entry) => {
      const code = String(entry.language ?? entry.locale ?? 'en')
      return { code, label: LANGUAGE_LABELS[code] ?? code.toUpperCase() }
    })
    i18n = { defaultLocale, locales }
    for (const language of languages) {
      const locale = String(language.language ?? language.locale ?? defaultLocale)
      const context: ProjectionContext = {
        locale,
        references,
        seenReferences,
      }
      const languageTabs = convertContainerToTabs(language, context, 'Documentation')
      if (language === defaultLanguage) tabs = languageTabs
    }
  } else {
    tabs = convertContainerToTabs(navigation, { references, seenReferences }, 'Documentation')
    if (tabs.length === 0 && Array.isArray(config.navigation)) {
      const groups = convertGroups(config.navigation, { references, seenReferences }, 'Overview')
      if (groups.length > 0) tabs = [{ tab: 'Documentation', groups }]
    }
  }

  if (tabs.length === 0) {
    warnings.push({
      code: 'unsupported-config',
      message: 'Mintlify navigation could not be projected; generated navigation will be used.',
    })
  }
  if (!tabs.some((tab) => tab.tab.toLowerCase() === 'changelog')) {
    tabs.push({ tab: 'Changelog', href: '/changelog' })
  }
  const redirects = Array.isArray(config.redirects)
    ? config.redirects.flatMap((value) => {
        const redirect = objectValue(value)
        if (!redirect || typeof redirect.source !== 'string' || typeof redirect.destination !== 'string') return []
        return [{
          source: redirect.source,
          destination: redirect.destination,
          ...(typeof redirect.permanent === 'boolean' ? { permanent: redirect.permanent } : {}),
        }]
      })
    : []
  return {
    docsConfig: { tabs, ...(i18n ? { i18n } : {}), ...(redirects.length > 0 ? { redirects } : {}) },
    pageReferences: references,
    warnings,
  }
}

function titleCase(value: string): string {
  return value
    .split(/[-_]/)
    .map((word) => ['api', 'cli', 'sdk', 'ui'].includes(word.toLowerCase())
      ? word.toUpperCase()
      : word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

interface GeneratedNavigationOptions {
  /** Dedicated docs platforms expose their primary sections as top-level tabs. */
  topLevelTabs?: boolean
  /** Ordered tabs recovered from the source site's rendered navigation. */
  topLevelNavigation?: ReadonlyArray<{
    section: string
    label: string
    pageId: string
  }>
}

const TOP_LEVEL_LABELS: Record<string, string> = {
  'api-reference': 'API Reference',
  cli: 'CLI',
  faqs: 'FAQs',
  introduction: 'Overview',
  'mcp-server': 'MCP Server',
  sdk: 'SDK',
}

function topLevelLabel(segment: string): string {
  return TOP_LEVEL_LABELS[segment] ?? titleCase(segment)
}

function groupsWithinSection(
  section: string,
  pageIds: Array<string>,
  sectionLabel = topLevelLabel(section),
): Array<MigrationNavigationGroup> {
  const groups = new Map<string, Array<string>>()
  for (const id of pageIds) {
    const relative = id === 'introduction'
      ? ''
      : id.startsWith(`${section}/`)
        ? id.slice(section.length + 1)
        : id
    const nestedSegment = relative.includes('/') ? relative.split('/', 1)[0] : 'overview'
    const group = groups.get(nestedSegment) ?? []
    group.push(id)
    groups.set(nestedSegment, group)
  }
  return [...groups].map(([segment, pages]) => ({
    group: segment === 'overview' ? sectionLabel : titleCase(segment),
    pages,
  }))
}

function preferredLandingPage(
  section: string,
  pageIds: Array<string>,
): string | undefined {
  const candidates = [
    section === 'introduction' ? 'introduction' : undefined,
    `${section}/overview`,
    `${section}/introduction`,
    section,
  ]
  return candidates.find((candidate): candidate is string => Boolean(candidate && pageIds.includes(candidate)))
}

/** Build deterministic fallback navigation from imported default-locale pages. */
export function buildNavigationFromPages(
  pages: Array<MigrationPage>,
  options: GeneratedNavigationOptions = {},
): MigrationDocsConfig {
  const ids = pages.filter((page) => !page.locale || page.locale === 'en').map((page) => page.navigationId)
  const ordered = [...new Set(ids)]
  if (options.topLevelTabs) {
    const sourceNavigation = (options.topLevelNavigation ?? []).flatMap((entry) => {
      const sectionPages = ordered.filter((id) => id === entry.section || id.startsWith(`${entry.section}/`))
      const pageId = ordered.includes(entry.pageId)
        ? entry.pageId
        : preferredLandingPage(entry.section, sectionPages) ?? sectionPages[0]
      return pageId ? [{ ...entry, pageId }] : []
    })
    if (sourceNavigation.length > 1) {
      const claimedIds = new Set<string>()
      const tabs = sourceNavigation.map((entry) => {
        const pageIds = ordered.filter((id) => {
          const matches = id === entry.pageId
            || id === entry.section
            || id.startsWith(`${entry.section}/`)
          if (matches) claimedIds.add(id)
          return matches
        })
        return { entry, pageIds }
      })
      // Mintlify's first tab is the documentation home and owns pages that do
      // not belong to another product tab (for example /create and /deploy).
      tabs[0].pageIds.push(...ordered.filter((id) => !claimedIds.has(id)))
      return {
        tabs: tabs.map(({ entry, pageIds }) => ({
          tab: entry.label,
          href: entry.pageId === 'introduction' ? '/' : `/${entry.pageId}`,
          groups: groupsWithinSection(entry.section, [...new Set(pageIds)], entry.label),
        })),
      }
    }
    const sectionNames = [...new Set(ordered
      .filter((id) => id.includes('/'))
      .map((id) => id.split('/', 1)[0]))]
    if (sectionNames.length > 1) {
      const defaultSection = sectionNames.includes('introduction')
        ? 'introduction'
        : sectionNames[0]
      const sections = new Map<string, Array<string>>()
      for (const id of ordered) {
        const section = id.includes('/') ? id.split('/', 1)[0] : defaultSection
        const bucket = sections.get(section) ?? []
        bucket.push(id)
        sections.set(section, bucket)
      }
      return {
        tabs: [...sections].map(([section, pageIds]) => {
          const label = topLevelLabel(section)
          const landingPage = preferredLandingPage(section, pageIds)
          return {
            tab: label,
            ...(landingPage
              ? { href: landingPage === 'introduction' ? '/' : `/${landingPage}` }
              : {}),
            groups: groupsWithinSection(section, pageIds),
          }
        }),
      }
    }
  }
  const buckets = new Map<string, Array<string>>()
  for (const id of ordered) {
    const segment = id.includes('/') ? id.split('/', 1)[0] : 'overview'
    const bucket = buckets.get(segment) ?? []
    bucket.push(id)
    buckets.set(segment, bucket)
  }
  const groups = [...buckets].map(([segment, pageIds]) => ({
    group: segment === 'overview' ? 'Overview' : titleCase(segment),
    pages: pageIds,
  }))
  return { tabs: [{ tab: 'Documentation', groups }] }
}

/** Exposed for repository discovery and focused unit tests. */
export function isDocumentationExtension(filename: string): boolean {
  return ['.md', '.mdx', '.rst', '.txt'].includes(extname(filename).toLowerCase())
}
