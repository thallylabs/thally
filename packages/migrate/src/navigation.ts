/**
 * Navigation projection for imported sites. Mintlify's schema is intentionally
 * more expressive than Thally's tab/group model, so complex containers are
 * flattened predictably while preserving page order and nested groups.
 */

import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, extname, relative } from 'node:path'

import { pageIdFromReference, resolveWithin, trimEdgeSlashes } from './path.js'
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

const MAX_MINTLIFY_CONFIG_BYTES = 2_000_000

export interface MintlifyNavigationResult {
  docsConfig: MigrationDocsConfig
  pageReferences: Array<MintlifyPageReference>
  warnings: Array<MigrationWarning>
}

export interface MintlifyProjectionOptions {
  /** Public URL migrations may expose page hrefs including the docs mount path. */
  pathPrefix?: string
}

/** Preserve Mintlify's implicit `/section` route for section landing pages. */
export function addMintlifyDirectoryRedirects(
  config: MigrationDocsConfig,
  pages: Array<MigrationPage>,
): MigrationDocsConfig {
  const pageIds = new Set(pages.filter((page) => !page.locale).map((page) => page.navigationId))
  const redirects = [...(config.redirects ?? [])]
  const redirectSources = new Set(redirects.map((redirect) => redirect.source.replace(/\/$/, '') || '/'))
  for (const page of pages) {
    if (page.locale || !/(?:^|\/)(?:overview|introduction)$/.test(page.navigationId)) continue
    const parent = page.navigationId.replace(/\/(?:overview|introduction)$/, '')
    if (!parent || pageIds.has(parent)) continue
    const source = `/${parent}`
    if (redirectSources.has(source)) continue
    redirects.push({ source, destination: `/${page.navigationId}`, permanent: false })
    redirectSources.add(source)
  }
  return redirects.length > 0 ? { ...config, redirects } : config
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

function projectedHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const href = value.trim()
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return undefined
  if (/^(?:javascript|data|vbscript|file):/i.test(href)) return undefined
  const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase()
  if (scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme)) return undefined
  return href
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
    if (Array.isArray(current)) {
      const index = Number(token)
      return Number.isSafeInteger(index) && index >= 0 ? current[index] : undefined
    }
    const object = objectValue(current)
    if (!object) return undefined
    return object[token.replace(/~1/g, '/').replace(/~0/g, '~')]
  }, root)
}

function readMintlifyJson(path: string, repositoryRoot: string): unknown {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`Mintlify config reference is not a regular file: ${relative(repositoryRoot, path)}`)
  }
  const realPath = realpathSync(path)
  const realRoot = realpathSync(repositoryRoot)
  resolveWithin(realRoot, relative(realRoot, realPath))
  if (lstatSync(realPath).size > MAX_MINTLIFY_CONFIG_BYTES) {
    throw new Error(`Mintlify config reference exceeded ${MAX_MINTLIFY_CONFIG_BYTES / 1_000_000} MB: ${relative(repositoryRoot, path)}`)
  }
  return JSON.parse(readFileSync(realPath, 'utf8')) as unknown
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
    const referencedRoot = readMintlifyJson(referencedFile, repositoryRoot)
    const referenced = jsonPointer(referencedRoot, pointer ? `#${pointer}` : '')
    const resolved = resolveJsonReferences(referenced, referencedFile, repositoryRoot, stack)
    stack.delete(stackKey)
    const siblings = Object.fromEntries(
      Object.entries(object)
        .filter(([key]) => key !== '$ref')
        .map(([key, entry]) => [
          key,
          resolveJsonReferences(entry, currentFile, repositoryRoot, stack),
        ]),
    )
    // Mintlify merges sibling keys over object-valued references. Retaining
    // this behavior matters for split navigation files that override one
    // label, link, or visibility flag at the reference site.
    return objectValue(resolved) ? { ...resolved as Record<string, unknown>, ...siblings } : resolved
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
  const raw = readMintlifyJson(configPath, repositoryRoot)
  return resolveJsonReferences(raw, configPath, repositoryRoot, new Set()) as Record<string, unknown>
}

function normalizePageRef(value: string, pathPrefix = ''): string | null {
  if (/^(?:https?:)?\/\//i.test(value) || value.startsWith('#')) return null
  let ref = localReference(value).split('?', 1)[0].replace(/^\/+/, '')
  const prefix = trimEdgeSlashes(pathPrefix)
  if (prefix && (ref === prefix || ref.startsWith(`${prefix}/`))) {
    ref = ref === prefix ? 'introduction' : ref.slice(prefix.length + 1)
  }
  ref = ref.replace(/\.(?:mdx?|rst|txt)$/i, '')
  // Mintlify routes are case-sensitive and commonly use camelCase filenames
  // (for example `additionalFiles`). Lowercasing here breaks both authored
  // navigation and links even though the source site resolves them correctly.
  return pageIdFromReference(ref, true)
}

interface ProjectionContext {
  locale?: string
  pathPrefix?: string
  references: Array<MintlifyPageReference>
  seenReferences: Set<string>
  warnings: Array<MigrationWarning>
  warningKeys: Set<string>
}

function warnOnce(context: ProjectionContext, key: string, message: string): void {
  if (context.warningKeys.has(key)) return
  context.warningKeys.add(key)
  context.warnings.push({ code: 'unsupported-config', message })
}

function iconName(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value
  const icon = objectValue(value)
  return typeof icon?.name === 'string' && icon.name ? icon.name : undefined
}

function containerPresentation(value: Record<string, unknown>): {
  description?: string
  icon?: string
} {
  return {
    ...(typeof value.description === 'string' && value.description.trim()
      ? { description: value.description.trim() }
      : {}),
    ...(iconName(value.icon) ? { icon: iconName(value.icon) } : {}),
  }
}

function registerReference(value: string, context: ProjectionContext): string | null {
  const localePrefix = context.locale ? `${context.locale}/` : ''
  const localizedValue = localePrefix && value.replace(/^\/+/, '').startsWith(localePrefix)
    ? value.replace(/^\/+/, '').slice(localePrefix.length)
    : value
  const navigationId = normalizePageRef(localizedValue, context.pathPrefix)
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
  const href = projectedHref(object.href)
  if (href && !object.pages && !object.groups) {
    const page = registerReference(href, context)
    if (page) return page
    warnOnce(
      context,
      'external-page-link',
      'External links nested inside a Mintlify sidebar cannot be represented as Thally pages and were omitted.',
    )
    return null
  }
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
      ...(iconName(object.icon) ? { icon: iconName(object.icon) } : {}),
      ...(object.hidden === true ? { hidden: true } : {}),
      pages: children,
    }
  }
  return null
}

function convertNavigationValues(
  values: Array<unknown>,
  context: ProjectionContext,
): Array<string | MigrationNavigationGroup> {
  return values.flatMap<string | MigrationNavigationGroup>((value) => {
    const page = convertPage(value, context)
    return page ? [page] : []
  })
}

interface NavigationProjectionTrace {
  rootContainerKind?: 'tabs' | 'anchors' | 'products' | 'dropdowns' | 'versions' | 'menus'
}

function convertContainerToTabs(
  containerValue: unknown,
  context: ProjectionContext,
  fallbackTab: string,
  trace?: NavigationProjectionTrace,
  depth = 0,
): Array<MigrationNavigationTab> {
  const container = objectValue(containerValue)
  if (!container) return []
  const containerKeys = ['tabs', 'anchors', 'products', 'dropdowns', 'versions', 'menus'] as const
  for (const key of containerKeys) {
    if (!Array.isArray(container[key])) continue
    const entries = [...container[key] as Array<unknown>]
    if (key === 'versions') {
      entries.sort((left, right) => Number(objectValue(right)?.default === true) - Number(objectValue(left)?.default === true))
    }
    const tabs = entries.flatMap((value, index) => {
      const object = objectValue(value)
      if (!object) return []
      const tab = labelFor(object, `${fallbackTab} ${index + 1}`)
      const href = projectedHref(object.href)
      const hasNestedContainers = containerKeys.some((containerKey) => Array.isArray(object[containerKey]))
      if (href && !object.pages && !object.groups && !hasNestedContainers) {
        return [{
          tab,
          href,
          ...containerPresentation(object),
          ...(object.hidden === true ? { hidden: true } : {}),
        }]
      }
      const nested = convertContainerToTabs(object, context, tab, trace, depth + 1)
      if (nested.length > 0) {
        if (nested.length === 1) {
          return [{
            ...nested[0],
            tab,
            ...containerPresentation(object),
            ...(href ? { href } : {}),
            ...(object.hidden === true ? { hidden: true } : {}),
          }]
        }
        const presentation = containerPresentation(object)
        return nested.map((item, childIndex) => ({
          ...presentation,
          ...item,
          tab: `${tab}: ${item.tab}`,
          ...(childIndex === 0 && href && !item.href ? { href } : {}),
          ...(object.hidden === true ? { hidden: true } : {}),
        }))
      }
      return []
    })
    if (tabs.length > 0) {
      if (depth === 0 && trace) trace.rootContainerKind = key
      return tabs
    }
  }
  const rawGroups = Array.isArray(container.groups) ? container.groups : []
  const rawPages = Array.isArray(container.pages) ? container.pages : []
  const hasRootNodes = typeof container.root === 'string' || rawPages.length > 0
  const values = [
    ...(typeof container.root === 'string' ? [container.root] : []),
    ...rawGroups,
    ...rawPages,
  ]
  const children = convertNavigationValues(values, context)
  return children.length > 0
    ? [{
        tab: fallbackTab,
        ...(hasRootNodes
          ? { pages: children }
          : { groups: children as Array<MigrationNavigationGroup> }),
        ...containerPresentation(container),
        ...(projectedHref(container.href) ? { href: projectedHref(container.href) } : {}),
        ...(container.hidden === true ? { hidden: true } : {}),
      }]
    : []
}

function projectedTheme(value: unknown): MigrationDocsConfig['theme'] {
  if (value === 'maple') return 'maple'
  if (['aspen', 'luma', 'sequoia'].includes(String(value))) return 'sharp'
  if (['almond', 'palm'].includes(String(value))) return 'minimal'
  return typeof value === 'string' ? 'default' : undefined
}

function projectedNavbar(value: unknown): MigrationDocsConfig['navbar'] {
  const navbar = objectValue(value)
  if (!navbar) return undefined
  const links = Array.isArray(navbar.links)
    ? navbar.links.flatMap((entry) => {
        const link = objectValue(entry)
        const href = projectedHref(link?.href)
        if (!link || !href) return []
        const label = typeof link.label === 'string' ? link.label : typeof link.name === 'string' ? link.name : ''
        if (!label) return []
        return [{ label, href, ...(link.type === 'github' ? { type: 'github' as const } : {}) }]
      })
    : []
  const primaryValue = objectValue(navbar.primary)
  const primaryHref = projectedHref(primaryValue?.href)
  const primary = primaryValue && primaryHref
    ? {
        label: typeof primaryValue.label === 'string'
          ? primaryValue.label
          : primaryValue.type === 'github' ? 'GitHub' : 'Get started',
        href: primaryHref,
      }
    : undefined
  return links.length > 0 || primary ? { ...(links.length > 0 ? { links } : {}), ...(primary ? { primary } : {}) } : undefined
}

function projectedGlobalNavigationLinks(
  value: unknown,
): NonNullable<NonNullable<MigrationDocsConfig['navbar']>['links']> {
  const global = objectValue(value)
  if (!global) return []
  const links: Array<{ label: string; href: string }> = []
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      entry.forEach(visit)
      return
    }
    const item = objectValue(entry)
    if (!item) return
    const href = projectedHref(item.href)
    if (href) {
      const label = labelFor(item, '')
      if (label) links.push({ label, href })
    }
    for (const key of ['tabs', 'anchors', 'dropdowns', 'products', 'versions', 'languages', 'menus']) {
      if (Array.isArray(item[key])) visit(item[key])
    }
  }
  visit(global)
  return links
}

function projectedFooter(value: unknown): MigrationDocsConfig['footer'] {
  const footer = objectValue(value)
  if (!footer) return undefined
  const socials = objectValue(footer.socials)
  const socialLinks = socials
    ? Object.fromEntries(Object.entries(socials).flatMap(([key, value]) => {
        const href = projectedHref(value)
        return href ? [[key, href]] : []
      }))
    : undefined
  const links = Array.isArray(footer.links)
    ? footer.links.flatMap((entry) => {
        const column = objectValue(entry)
        if (!column || !Array.isArray(column.items)) return []
        const heading = typeof column.heading === 'string'
          ? column.heading
          : typeof column.header === 'string' ? column.header : ''
        const items = column.items.flatMap((item) => {
          const link = objectValue(item)
          const href = projectedHref(link?.href)
          return link && typeof link.label === 'string' && href
            ? [{ label: link.label, href }]
            : []
        })
        return heading && items.length > 0 ? [{ heading, items }] : []
      })
    : []
  return (socialLinks && Object.keys(socialLinks).length > 0) || links.length > 0
    ? { ...(socialLinks && Object.keys(socialLinks).length > 0 ? { socials: socialLinks } : {}), ...(links.length > 0 ? { links } : {}) }
    : undefined
}

function projectedFont(value: unknown): { family: string; weight?: Array<string> } | undefined {
  if (typeof value === 'string' && value) return { family: value }
  const font = objectValue(value)
  if (!font) return undefined
  const family = typeof font.family === 'string'
    ? font.family
    : typeof font.name === 'string' ? font.name : undefined
  if (!family) return undefined
  const weight = Array.isArray(font.weight)
    ? font.weight.map(String)
    : Array.isArray(font.weights) ? font.weights.map(String) : undefined
  return { family, ...(weight && weight.length > 0 ? { weight } : {}) }
}

function projectedCompatibleConfig(config: Record<string, unknown>): Omit<MigrationDocsConfig, 'tabs' | 'i18n' | 'redirects'> {
  const banner = objectValue(config.banner)
  const bannerContent = banner && (typeof banner.content === 'string' || objectValue(banner.content))
    ? banner.content as string | Record<string, string>
    : undefined
  const bannerType = banner && ['info', 'warning', 'critical'].includes(String(banner.type ?? banner.variant))
    ? String(banner.type ?? banner.variant) as 'info' | 'warning' | 'critical'
    : undefined
  const bannerColor = objectValue(banner?.color)
  const bodyFont = projectedFont(objectValue(config.fonts)?.body ?? config.fonts)
  const headingFont = projectedFont(objectValue(config.fonts)?.heading)
  const feedback = objectValue(config.feedback)
  const seo = objectValue(config.seo)
  const navbar = projectedNavbar(config.navbar)
  const globalLinks = projectedGlobalNavigationLinks(objectValue(config.navigation)?.global)
  const navbarLinks = [...new Map(
    [...(navbar?.links ?? []), ...globalLinks].map((link) => [`${link.label}:${link.href}`, link]),
  ).values()]
  const projectedNavigation = navbarLinks.length > 0 || navbar?.primary
    ? { ...(navbarLinks.length > 0 ? { links: navbarLinks } : {}), ...(navbar?.primary ? { primary: navbar.primary } : {}) }
    : undefined
  return {
    ...(projectedTheme(config.theme) ? { theme: projectedTheme(config.theme) } : {}),
    ...(bannerContent ? {
      banner: {
        content: bannerContent,
        ...(banner?.dismissible === false ? { dismissible: false } : {}),
        ...(typeof banner?.id === 'string' ? { id: banner.id } : {}),
        ...(typeof banner?.revision === 'string' ? { revision: banner.revision } : {}),
        ...(bannerType ? { type: bannerType } : {}),
        ...(bannerColor ? { color: {
          ...(typeof bannerColor.light === 'string' ? { light: bannerColor.light } : {}),
          ...(typeof bannerColor.dark === 'string' ? { dark: bannerColor.dark } : {}),
        } } : {}),
      },
    } : {}),
    ...(projectedNavigation ? { navbar: projectedNavigation } : {}),
    ...(projectedFooter(config.footer) ? { footer: projectedFooter(config.footer) } : {}),
    ...(bodyFont || headingFont ? { fonts: { ...(bodyFont ? { body: bodyFont } : {}), ...(headingFont ? { heading: headingFont } : {}) } } : {}),
    ...(seo?.indexing === 'all' ? { seo: { indexing: 'all' } } : {}),
    ...(typeof feedback?.thumbsRating === 'boolean' ? { feedback: { thumbsRating: feedback.thumbsRating } } : {}),
  }
}

/** Convert current and legacy Mintlify navigation into Thally's schema. */
export function projectMintlifyNavigation(
  config: Record<string, unknown>,
  options: MintlifyProjectionOptions = {},
): MintlifyNavigationResult {
  const warnings: Array<MigrationWarning> = []
  const references: Array<MintlifyPageReference> = []
  const seenReferences = new Set<string>()
  const warningKeys = new Set<string>()
  const navigation = objectValue(config.navigation) ?? config
  const languages = Array.isArray(navigation.languages)
    ? navigation.languages.map(objectValue).filter((value): value is Record<string, unknown> => Boolean(value))
    : []
  let tabs: Array<MigrationNavigationTab> = []
  let i18n: MigrationDocsConfig['i18n']
  const projectionTrace: NavigationProjectionTrace = {}

  if (languages.length > 0) {
    const defaultLanguage = languages.find((entry) => entry.default === true) ?? languages[0]
    const defaultLocale = String(defaultLanguage.language ?? defaultLanguage.locale ?? 'en')
    const locales = languages.map((entry) => {
      const code = String(entry.language ?? entry.locale ?? 'en')
      let label: string | undefined = LANGUAGE_LABELS[code]
      try {
        label ??= new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? undefined
      } catch {
        // Unknown extension tags remain readable as their normalized code.
      }
      return { code, label: label ?? code.toUpperCase() }
    })
    i18n = { defaultLocale, locales }
    for (const language of languages) {
      const locale = String(language.language ?? language.locale ?? defaultLocale)
      const context: ProjectionContext = {
        locale,
        pathPrefix: options.pathPrefix,
        references,
        seenReferences,
        warnings,
        warningKeys,
      }
      const languageTabs = convertContainerToTabs(
        language,
        context,
        'Documentation',
        language === defaultLanguage ? projectionTrace : undefined,
      )
      if (language === defaultLanguage) tabs = languageTabs
    }
  } else {
    const context = { references, seenReferences, warnings, warningKeys, pathPrefix: options.pathPrefix }
    tabs = convertContainerToTabs(navigation, context, 'Documentation', projectionTrace)
    if (tabs.length === 0 && Array.isArray(config.navigation)) {
      const children = convertNavigationValues(config.navigation, context)
      if (children.length > 0) {
        const hasRootPages = children.some((page) => typeof page === 'string')
        tabs = [{
          tab: 'Documentation',
          ...(hasRootPages
            ? { pages: children }
            : { groups: children as Array<MigrationNavigationGroup> }),
        }]
      }
    }
  }

  if (tabs.length === 0) {
    warnings.push({
      code: 'unsupported-config',
      message: 'Mintlify navigation could not be projected; generated navigation will be used.',
    })
  }
  const redirects = Array.isArray(config.redirects)
    ? config.redirects.flatMap((value) => {
        const redirect = objectValue(value)
        if (!redirect || typeof redirect.source !== 'string' || typeof redirect.destination !== 'string') return []
        const source = redirect.source.trim()
        const destination = redirect.destination.trim()
        if (!source.startsWith('/') || !destination.startsWith('/')
          || source.startsWith('//') || destination.startsWith('//')) return []
        return [{
          source,
          destination,
          ...(typeof redirect.permanent === 'boolean' ? { permanent: redirect.permanent } : {}),
        }]
      })
    : []
  return {
    docsConfig: {
      tabs,
      ...(projectionTrace.rootContainerKind === 'dropdowns'
        ? { navigation: { display: 'dropdown' as const } }
        : {}),
      ...projectedCompatibleConfig(config),
      ...(i18n ? { i18n } : {}),
      ...(redirects.length > 0 ? { redirects } : {}),
    },
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
