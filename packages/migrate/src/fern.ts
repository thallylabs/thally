/**
 * Static Fern (`fern/docs.yml`) repository projection. Fern navigation and
 * generator config are plain YAML data files, so this adapter only ever
 * parses them with `yaml` and never imports or executes JavaScript.
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs'

import { parse as parseYaml } from 'yaml'

import { isRedirectPathSafe, translateRedirectWildcards } from './navigation.js'
import { resolveWithin } from './path.js'
import type {
  MigrationDocsConfig,
  MigrationNavigationGroup,
  MigrationNavigationTab,
  MigrationWarning,
} from './types.js'

const MAX_CONFIG_BYTES = 2_000_000

export interface FernPageDescriptor {
  /** Path to the referenced page file, relative to the Fern root. */
  sourcePath: string
  navigationId: string
}

export interface FernNavigationResult {
  docsConfig: MigrationDocsConfig
  descriptors: Array<FernPageDescriptor>
  warnings: Array<MigrationWarning>
  /** The first `api:` node's own value (a display name or, in multi-API repos, a `fern/apis/<name>` identifier), if any. */
  apiName?: string
  /** Label of the tab that owns the first `api:` node, if that tab also has other content and survived projection. */
  apiTabLabel?: string
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function titleCase(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => ['api', 'cli', 'sdk', 'ui'].includes(word.toLowerCase())
      ? word.toUpperCase()
      : word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function readBoundedYaml(path: string): unknown {
  if (lstatSync(path).size > MAX_CONFIG_BYTES) {
    throw new Error('Fern config exceeded the 2 MB static-parser limit.')
  }
  return parseYaml(readFileSync(path, 'utf8'))
}

/** Read `fern/docs.yml` without executing anything. */
export function readFernConfig(fernRoot: string): { config: Record<string, unknown>; sourcePath: string } | null {
  const sourcePath = 'docs.yml'
  const path = resolveWithin(fernRoot, sourcePath)
  if (!existsSync(path) || !lstatSync(path).isFile()) return null
  const config = objectValue(readBoundedYaml(path))
  if (!config) throw new Error('fern/docs.yml must contain an object.')
  return { config, sourcePath }
}

interface WalkContext {
  descriptors: Array<FernPageDescriptor>
  seenNavigationIds: Set<string>
  sawApi: boolean
  /** The first `api:` node's own value, used to locate its OpenAPI spec via generators.yml/fern/apis/<name>. */
  apiName?: string
  /** Label of the tab that owns the first `api:` node, so the OpenAPI spec attaches to that exact tab. */
  apiTabLabel?: string
  warnings: Array<MigrationWarning>
  warningKeys: Set<string>
  /** Bare tab/section routes with no page of their own, soft-redirected to their first descendant. */
  bareRouteRedirects: Array<{ source: string; destination: string }>
}

function warnOnce(context: WalkContext, key: string, message: string): void {
  if (context.warningKeys.has(key)) return
  context.warningKeys.add(key)
  context.warnings.push({ code: 'unsupported-config', message })
}

function firstLeafId(nodes: Array<string | MigrationNavigationGroup>): string | undefined {
  for (const node of nodes) {
    if (typeof node === 'string') return node
    const nested = firstLeafId(node.pages)
    if (nested) return nested
  }
  return undefined
}

/** A tab or section with no page of its own still has a public URL that Fern resolves to its first descendant. */
function addBareRouteRedirect(
  segments: Array<string>,
  pages: Array<string | MigrationNavigationGroup>,
  context: WalkContext,
): void {
  if (segments.length === 0) return
  const destination = firstLeafId(pages)
  const source = segments.join('/')
  if (destination && destination !== source) {
    context.bareRouteRedirects.push({ source: `/${source}`, destination: `/${destination}` })
  }
}

/**
 * Fern's own slugifier treats any non-alphanumeric run (including `.`, which
 * Thally's shared `slugifySegment` deliberately preserves for other
 * platforms) as a separator, so Fern gets its own minimal one here.
 */
function fernBasicSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

/**
 * Fern derives a default slug from a display name by lowercasing, replacing
 * non-alphanumeric runs with hyphens, dropping parentheses, and splitting
 * camelCase/acronym boundaries (`OpenAI` -> `open-ai`, `SDKs` -> `sd-ks`) —
 * confirmed against buildwithfern.com's own "Configuring slugs" doc and a
 * live site's sitemap. Only the label fallback needs this; an authored
 * `slug` is used as literal, already-intended path text.
 */
function fernLabelSlug(label: string): string {
  const decamelized = label
    .replace(/[()]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
  return fernBasicSlug(decamelized)
}

/**
 * A Fern tab, section, or page contributes its slugified label as a URL
 * segment by default (confirmed against a live Fern site's sitemap: nested
 * sections with no `slug` field still nest their descendants by title).
 * `slug` overrides the label; `skip-slug: true` omits the segment entirely.
 */
function segmentFor(value: Record<string, unknown>, label: string): string | null {
  if (value['skip-slug'] === true) return null
  const explicit = typeof value.slug === 'string' ? value.slug.trim() : ''
  return (explicit ? fernBasicSlug(explicit) : fernLabelSlug(label)) || null
}

function uniqueNavigationId(base: string, context: WalkContext): string {
  if (!context.seenNavigationIds.has(base)) return base
  let index = 2
  while (context.seenNavigationIds.has(`${base}-${index}`)) index++
  return `${base}-${index}`
}

function registerPageAt(rawPath: string, base: string, context: WalkContext): string {
  const sourcePath = rawPath.trim().replace(/^\.\//, '')
  const navigationId = uniqueNavigationId(base || 'introduction', context)
  context.seenNavigationIds.add(navigationId)
  context.descriptors.push({ sourcePath, navigationId })
  return navigationId
}

function registerPage(
  object: Record<string, unknown>,
  parentSegments: Array<string>,
  context: WalkContext,
): string | null {
  if (typeof object.path !== 'string' || !object.path.trim()) return null
  const label = typeof object.page === 'string' && object.page.trim() ? object.page.trim() : 'Untitled'
  const segment = segmentFor(object, label)
  const base = [...parentSegments, segment].filter(Boolean).join('/')
  return registerPageAt(object.path, base, context)
}

/** A `section`/`page`/`link`/`api`/`changelog` node from `layout` or `contents`. */
function convertNode(
  node: unknown,
  parentSegments: Array<string>,
  context: WalkContext,
): string | MigrationNavigationGroup | null {
  const object = objectValue(node)
  if (!object) return null

  if (typeof object.page === 'string') return registerPage(object, parentSegments, context)

  if (typeof object.section === 'string') {
    const label = object.section
    const segment = segmentFor(object, label)
    const segments = segment ? [...parentSegments, segment] : parentSegments
    const contents = Array.isArray(object.contents) ? object.contents : []
    const pages: Array<string | MigrationNavigationGroup> = []
    // A section can also carry its own `path`, making the section itself a
    // clickable landing page hosted at the section's own segment (not a
    // further-nested page segment).
    const hasOwnPath = typeof object.path === 'string' && object.path.trim().length > 0
    if (hasOwnPath) {
      pages.push(registerPageAt(object.path as string, segments.join('/'), context))
    }
    for (const child of contents) {
      const converted = convertNode(child, segments, context)
      if (converted) pages.push(converted)
    }
    if (pages.length === 0) return null
    // A section without its own `path` still has a public URL at its segment;
    // Fern resolves that bare route to the section's first descendant page.
    if (!hasOwnPath && segment) addBareRouteRedirect(segments, pages, context)
    return {
      group: label,
      ...(typeof object.icon === 'string' ? { icon: object.icon } : {}),
      ...(object.hidden === true ? { hidden: true } : {}),
      pages,
    }
  }

  if (typeof object.link === 'string') {
    warnOnce(
      context,
      'fern-link',
      'Fern navigation "link" entries are external and cannot be nested inside a Thally group; add them to the navbar manually.',
    )
    return null
  }

  if (typeof object.api === 'string') {
    if (context.sawApi) {
      warnOnce(context, 'fern-multiple-api', 'Multiple Fern API sections were found; only the first was imported.')
    } else {
      // `api` is the display title shown in the nav; `api-name` (when
      // present) is the actual `fern/apis/<name>/` folder name. A repo with
      // `api: Plant API` / `api-name: plants` has no `apis/Plant API`
      // folder, so preferring `api-name` is required to find the spec.
      context.apiName = typeof object['api-name'] === 'string' ? object['api-name'] : object.api
    }
    context.sawApi = true
    return null
  }

  if (typeof object.changelog === 'string') {
    warnOnce(context, 'fern-changelog', 'Fern changelog sections are not supported and were omitted.')
    return null
  }

  return null
}

function convertNodes(
  nodes: Array<unknown>,
  parentSegments: Array<string>,
  context: WalkContext,
): Array<string | MigrationNavigationGroup> {
  return nodes.flatMap((node) => {
    const converted = convertNode(node, parentSegments, context)
    return converted ? [converted] : []
  })
}

function groupsFromConverted(
  converted: Array<string | MigrationNavigationGroup>,
): Array<MigrationNavigationGroup> {
  const loosePages = converted.filter((entry): entry is string => typeof entry === 'string')
  const groups = converted.filter((entry): entry is MigrationNavigationGroup => typeof entry !== 'string')
  return loosePages.length > 0 ? [{ group: 'Overview', pages: loosePages }, ...groups] : groups
}

/** Resolve the default Fern version's navigation when no top-level nav exists. */
function resolveVersionedNavigation(
  config: Record<string, unknown>,
  fernRoot: string,
  context: WalkContext,
): Record<string, unknown> {
  if (Array.isArray(config.navigation)) return config
  if (Array.isArray(config.products)) {
    warnOnce(context, 'fern-products', 'Fern multi-product docs are not supported; only this docs.yml was imported.')
    return config
  }
  if (!Array.isArray(config.versions)) return config
  const versions = config.versions.flatMap((entry) => {
    const version = objectValue(entry)
    return version ? [version] : []
  })
  const chosen = versions.find((version) => version.default === true) ?? versions[0]
  const skipped = versions.filter((version) => version !== chosen)
    .map((version) => (typeof version.version === 'string' ? version.version : undefined))
    .filter((name): name is string => Boolean(name))
  if (skipped.length > 0) {
    warnOnce(
      context,
      'fern-versions',
      `Only the default Fern version was imported; other versions were skipped: ${skipped.join(', ')}.`,
    )
  }
  if (!chosen || typeof chosen.path !== 'string') return config
  try {
    const versionPath = resolveWithin(fernRoot, chosen.path)
    if (!existsSync(versionPath) || !lstatSync(versionPath).isFile()) {
      warnOnce(context, 'fern-version-not-file', `Fern version file "${chosen.path}" is not a regular file and was skipped.`)
      return config
    }
    const versionConfig = objectValue(readBoundedYaml(versionPath))
    if (!versionConfig) return config
    return { ...config, navigation: versionConfig.navigation, tabs: versionConfig.tabs ?? config.tabs }
  } catch (error) {
    warnOnce(
      context,
      'fern-version-read-failed',
      `Fern version file "${chosen.path}" could not be read (${error instanceof Error ? error.message : String(error)}) and was skipped.`,
    )
    return config
  }
}

/** Project a Fern `docs.yml` navigation tree into Thally tabs/groups. */
export function projectFernNavigation(input: {
  config: Record<string, unknown>
  fernRoot: string
}): FernNavigationResult {
  const context: WalkContext = {
    descriptors: [],
    seenNavigationIds: new Set(),
    sawApi: false,
    warnings: [],
    warningKeys: new Set(),
    bareRouteRedirects: [],
  }
  const config = resolveVersionedNavigation(input.config, input.fernRoot, context)
  const tabsMeta = objectValue(config.tabs) ?? {}
  const navigation = config.navigation
  let tabs: Array<MigrationNavigationTab> = []

  const isTabbedNavigation = Array.isArray(navigation)
    && navigation.length > 0
    && navigation.every((entry) => typeof objectValue(entry)?.tab === 'string')

  if (isTabbedNavigation) {
    tabs = (navigation as Array<Record<string, unknown>>).flatMap((entry) => {
      const id = String(entry.tab)
      const meta = objectValue(tabsMeta[id]) ?? {}
      const label = typeof meta['display-name'] === 'string' ? meta['display-name'] : titleCase(id)
      const tabSegment = segmentFor(meta, label)
      const layout = Array.isArray(entry.layout) ? entry.layout : []
      const sawApiBefore = context.sawApi
      const groups = groupsFromConverted(convertNodes(layout, tabSegment ? [tabSegment] : [], context))
      if (!sawApiBefore && context.sawApi) context.apiTabLabel = label
      if (groups.length === 0) return []
      if (tabSegment) addBareRouteRedirect([tabSegment], groups, context)
      return [{
        tab: label,
        ...(typeof meta.icon === 'string' ? { icon: meta.icon } : {}),
        groups,
      }]
    })
  } else if (Array.isArray(navigation)) {
    const groups = groupsFromConverted(convertNodes(navigation, [], context))
    if (groups.length > 0) tabs = [{ tab: 'Documentation', groups }]
  }

  if (tabs.length === 0) {
    context.warnings.push({
      code: 'unsupported-config',
      message: 'Fern navigation could not be projected; generated navigation will be used.',
    })
  }

  const navbarLinks = Array.isArray(config['navbar-links'])
    ? (config['navbar-links'] as Array<unknown>).flatMap((entry) => {
        const link = objectValue(entry)
        const href = typeof link?.url === 'string'
          ? link.url
          : typeof link?.href === 'string' ? link.href : typeof link?.value === 'string' ? link.value : undefined
        const label = typeof link?.text === 'string'
          ? link.text
          : typeof link?.label === 'string' ? link.label : link?.type === 'github' ? 'GitHub' : undefined
        return href && label ? [{ label, href, ...(link?.type === 'github' ? { type: 'github' as const } : {}) }] : []
      })
    : []

  const redirects = Array.isArray(config.redirects)
    ? (config.redirects as Array<unknown>).flatMap((value) => {
        const redirect = objectValue(value)
        if (!redirect || typeof redirect.source !== 'string' || typeof redirect.destination !== 'string') return []
        const rawSource = redirect.source.trim()
        const rawDestination = redirect.destination.trim()
        if (!isRedirectPathSafe(rawSource, rawDestination)) return []
        const translated = translateRedirectWildcards(rawSource, rawDestination)
        if (!translated) {
          warnOnce(
            context,
            `fern-redirect-wildcard-${rawSource}`,
            `Redirect from ${rawSource} uses a wildcard Next.js cannot express and was dropped.`,
          )
          return []
        }
        return [{
          source: translated.source,
          destination: translated.destination,
          ...(typeof redirect.permanent === 'boolean' ? { permanent: redirect.permanent } : {}),
        }]
      })
    : []

  // `title`/`colors.accent-primary` are mapped by the repository adapter into
  // `MigrationBundle.site`; logo/favicon files live under `public/brand/` by
  // fixed filename rather than a docs.json-style config field, so they can
  // only be flagged for manual follow-up here.
  if (config.logo || config.favicon) {
    warnOnce(
      context,
      'fern-branding',
      'Fern logo and favicon were not migrated; add them to public/brand/ (default-logo-light.svg, default-logo-dark.svg, default-favicon-light.svg, default-favicon-dark.svg).',
    )
  }

  const authoredSources = new Set(redirects.map((redirect) => redirect.source))
  const allRedirects = [
    ...redirects,
    ...context.bareRouteRedirects.filter((redirect) => !authoredSources.has(redirect.source)),
  ]

  return {
    docsConfig: {
      tabs,
      ...(navbarLinks.length > 0 ? { navbar: { links: navbarLinks } } : {}),
      ...(allRedirects.length > 0 ? { redirects: allRedirects } : {}),
    },
    descriptors: context.descriptors,
    warnings: context.warnings,
    ...(context.apiName ? { apiName: context.apiName } : {}),
    ...(context.apiTabLabel ? { apiTabLabel: context.apiTabLabel } : {}),
  }
}
