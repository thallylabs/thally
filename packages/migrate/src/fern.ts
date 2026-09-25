/**
 * Static Fern (`fern/docs.yml`) repository projection. Fern navigation and
 * generator config are plain YAML data files, so this adapter only ever
 * parses them with `yaml` and never imports or executes JavaScript.
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { isRedirectPathSafe, translateRedirectWildcards } from './navigation.js'
import { resolveWithin, resolveWithinRoot } from './path.js'
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

/** One `api:` navigation node, resolved to the name/tab Thally needs to bind its spec. */
export interface FernApiSection {
  /** The node's own value (a display name or, in multi-API repos, a `fern/apis/<name>` identifier). */
  name: string
  /** True when `name` came from an explicit `api-name` field rather than falling back to the `api:` display title. */
  nameExplicit: boolean
  /** Label of the tab that owns this node, if that tab also has other content and survived projection. */
  tabLabel?: string
  /**
   * Route segments (section slugs) leading to this node, used only to
   * disambiguate two `api:` nodes that land on the same `tabLabel` — a
   * "Production API Reference" and "Testnet API Reference" section both
   * nested under one tab both want that tab's label; without this, the
   * second one silently overwrites the first tab's binding instead of
   * getting its own tab.
   */
  routeSegments: Array<string>
}

export interface FernNavigationResult {
  docsConfig: MigrationDocsConfig
  descriptors: Array<FernPageDescriptor>
  warnings: Array<MigrationWarning>
  /** Every `api:` node found in navigation, in document order. A repo can declare several (e.g. a REST and a WebSocket API in separate tabs). */
  apiSections: Array<FernApiSection>
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
  /** Every `api:` node seen so far, in document order; `tabLabel` is filled in once its owning tab finishes walking. */
  apiSections: Array<FernApiSection>
  warnings: Array<MigrationWarning>
  warningKeys: Set<string>
  /** Bare tab/section routes with no page of their own, soft-redirected to their first descendant. */
  bareRouteRedirects: Array<{ source: string; destination: string }>
  /** Slugified segment -> the literal explicit `slug` it was derived from, when the two differ (e.g. `baml-client` -> `baml_client`). */
  segmentAliases: Map<string, string>
  /**
   * Directory, relative to `fernRoot` (posix, no trailing slash, '' at the
   * root), that a page's `path` is actually relative to. A product's own
   * config lives under `fern/products/<name>/`, so its pages resolve there
   * rather than at the Fern root, even though the product's *route* segment
   * is unrelated and handled separately via `parentSegments`.
   */
  pathPrefix: string
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

/** A literal explicit `slug` value is only trusted as a redirect segment when it's already plain URL-safe text. */
const FERN_SEGMENT_ALIAS = /^[\w.-]+$/

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
 *
 * An author-written `slug` is intentional URL text (e.g. BAML's `slug:
 * baml_client`, matching its own `baml_client/` folder name) — Fern serves
 * it literally, underscore and all. `fernBasicSlug` still squashes it into
 * Thally's usual hyphenated route (kept as the canonical route: changing it
 * would be a wider behavior change than this warrants), but when the two
 * differ, the literal form is recorded as a segment alias so
 * `fernUnderscoreAliasRedirects` can add a redirect from the original
 * folder-name-shaped link to the route Thally actually uses.
 */
function segmentFor(value: Record<string, unknown>, label: string, context?: WalkContext): string | null {
  if (value['skip-slug'] === true) return null
  const explicit = typeof value.slug === 'string' ? value.slug.trim() : ''
  if (!explicit) return fernLabelSlug(label) || null
  const slugified = fernBasicSlug(explicit)
  if (context && explicit !== slugified && FERN_SEGMENT_ALIAS.test(explicit)) {
    context.segmentAliases.set(slugified, explicit)
  }
  return slugified || null
}

function uniqueNavigationId(base: string, context: WalkContext): string {
  if (!context.seenNavigationIds.has(base)) return base
  let index = 2
  while (context.seenNavigationIds.has(`${base}-${index}`)) index++
  return `${base}-${index}`
}

function registerPageAt(rawPath: string, base: string, context: WalkContext): string {
  const relativePath = rawPath.trim().replace(/^\.\//, '')
  const sourcePath = context.pathPrefix ? `${context.pathPrefix}/${relativePath}` : relativePath
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
  const segment = segmentFor(object, label, context)
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
    const segment = segmentFor(object, label, context)
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
    // `api` is the display title shown in the nav; `api-name` (when
    // present) is the actual `fern/apis/<name>/` folder name. A repo with
    // `api: Plant API` / `api-name: plants` has no `apis/Plant API`
    // folder, so preferring `api-name` is required to find the spec. A repo
    // can declare several `api:` nodes (e.g. a REST API and a WebSocket API
    // in separate tabs) — each is tracked and resolved independently rather
    // than only ever importing the first one found.
    context.apiSections.push({
      name: typeof object['api-name'] === 'string' ? object['api-name'] : object.api,
      nameExplicit: typeof object['api-name'] === 'string',
      routeSegments: parentSegments,
    })
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

/**
 * Resolve the default Fern version's navigation when no top-level nav
 * exists. `configDir` is the directory `chosen.path` is conventionally
 * relative to (the Fern root for a top-level docs.yml, or a product's own
 * directory for a product config); `fernRoot` remains the security boundary.
 */
function resolveVersionedNavigation(
  config: Record<string, unknown>,
  configDir: string,
  fernRoot: string,
  context: WalkContext,
): Record<string, unknown> {
  if (Array.isArray(config.navigation)) return config
  if (Array.isArray(config.products)) {
    warnOnce(context, 'fern-products', 'Nested Fern multi-product docs are not supported; only this docs.yml was imported.')
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
    const versionPath = resolveWithinRoot(configDir, chosen.path, fernRoot)
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

/**
 * Build tabs for one docs config (the top-level docs.yml, or one product's
 * own config), rooted at `routePrefix`. Shared by the plain top-level path
 * and by `projectFernProducts` so both get identical tabbed/flat-navigation
 * and version-resolution handling.
 */
function buildTabsFromConfig(
  rawConfig: Record<string, unknown>,
  configDir: string,
  fernRoot: string,
  routePrefix: Array<string>,
  fallbackTabLabel: string,
  context: WalkContext,
): Array<MigrationNavigationTab> {
  const config = resolveVersionedNavigation(rawConfig, configDir, fernRoot, context)
  const tabsMeta = objectValue(config.tabs) ?? {}
  const navigation = config.navigation

  const isTabbedNavigation = Array.isArray(navigation)
    && navigation.length > 0
    && navigation.every((entry) => typeof objectValue(entry)?.tab === 'string')

  if (isTabbedNavigation) {
    return (navigation as Array<Record<string, unknown>>).flatMap((entry) => {
      const id = String(entry.tab)
      const meta = objectValue(tabsMeta[id]) ?? {}
      const label = typeof meta['display-name'] === 'string' ? meta['display-name'] : titleCase(id)
      const tabSegment = segmentFor(meta, label, context)
      const segments = [...routePrefix, ...(tabSegment ? [tabSegment] : [])]
      const layout = Array.isArray(entry.layout) ? entry.layout : []
      const sectionsBefore = context.apiSections.length
      const groups = groupsFromConverted(convertNodes(layout, segments, context))
      for (let index = sectionsBefore; index < context.apiSections.length; index += 1) {
        context.apiSections[index].tabLabel ??= label
      }
      if (groups.length === 0) return []
      if (segments.length > 0) addBareRouteRedirect(segments, groups, context)
      return [{
        tab: label,
        ...(typeof meta.icon === 'string' ? { icon: meta.icon } : {}),
        groups,
      }]
    })
  }
  if (Array.isArray(navigation)) {
    const sectionsBefore = context.apiSections.length
    const groups = groupsFromConverted(convertNodes(navigation, routePrefix, context))
    for (let index = sectionsBefore; index < context.apiSections.length; index += 1) {
      context.apiSections[index].tabLabel ??= fallbackTabLabel
    }
    if (groups.length > 0) {
      if (routePrefix.length > 0) addBareRouteRedirect(routePrefix, groups, context)
      return [{ tab: fallbackTabLabel, groups }]
    }
  }
  return []
}

/**
 * Project Fern's `products:` (a docs.yml that fans out into several
 * independently-navigable products, e.g. buildwithfern.com/learn) into one
 * top-level tab per product, each routed under its own `slug`/display-name
 * segment and reading its pages from its own `fern/products/<name>/`
 * directory.
 */
function projectFernProducts(
  rawProducts: Array<unknown>,
  fernRoot: string,
  context: WalkContext,
): Array<MigrationNavigationTab> {
  return rawProducts.flatMap((entry) => {
    const product = objectValue(entry)
    const rawPath = typeof product?.path === 'string' ? product.path.trim() : ''
    if (!product || !rawPath) return []
    const label = typeof product['display-name'] === 'string' && product['display-name'].trim()
      ? product['display-name'].trim()
      : 'Product'
    let productPath: string
    try {
      productPath = resolveWithin(fernRoot, rawPath)
    } catch {
      warnOnce(context, `fern-product-unsafe-${rawPath}`, `Fern product "${label}" path "${rawPath}" is unsafe and was skipped.`)
      return []
    }
    if (!existsSync(productPath) || !lstatSync(productPath).isFile()) {
      warnOnce(context, `fern-product-missing-${rawPath}`, `Fern product "${label}" path "${rawPath}" does not exist and was skipped.`)
      return []
    }
    let productConfig: Record<string, unknown> | null
    try {
      productConfig = objectValue(readBoundedYaml(productPath))
    } catch (error) {
      warnOnce(
        context,
        `fern-product-read-failed-${rawPath}`,
        `Fern product "${label}" could not be read (${error instanceof Error ? error.message : String(error)}) and was skipped.`,
      )
      return []
    }
    if (!productConfig) return []
    const productDir = dirname(productPath)
    const routeSegment = segmentFor(product, label, context)
    const priorPrefix = context.pathPrefix
    context.pathPrefix = relative(fernRoot, productDir).replace(/\\/g, '/')
    try {
      return buildTabsFromConfig(
        productConfig,
        productDir,
        fernRoot,
        routeSegment ? [routeSegment] : [],
        label,
        context,
      )
    } finally {
      context.pathPrefix = priorPrefix
    }
  })
}

/** Project a Fern `docs.yml` navigation tree into Thally tabs/groups. */
export function projectFernNavigation(input: {
  config: Record<string, unknown>
  fernRoot: string
}): FernNavigationResult {
  const context: WalkContext = {
    descriptors: [],
    seenNavigationIds: new Set(),
    apiSections: [],
    warnings: [],
    warningKeys: new Set(),
    bareRouteRedirects: [],
    segmentAliases: new Map(),
    pathPrefix: '',
  }
  const config = input.config
  const hasProducts = Array.isArray(config.products) && config.products.length > 0 && !Array.isArray(config.navigation)
  const tabs = hasProducts
    ? projectFernProducts(config.products as Array<unknown>, input.fernRoot, context)
    : buildTabsFromConfig(config, input.fernRoot, input.fernRoot, [], 'Documentation', context)

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
  const knownIds = new Set(context.descriptors.map((descriptor) => descriptor.navigationId))
  // A page whose route includes a segment Fern derived from an explicit
  // `slug` that got hyphenated (see `segmentFor`) is also reachable on the
  // live Fern site at its literal, unslugified form (Fern's own routing is
  // file/slug-based and tolerates it) — e.g. BAML's `slug: baml_client`
  // means both `/ref/baml-client/...` (Thally's route) and
  // `/ref/baml_client/...` (in-body links, matching the folder name) are
  // live. Add one redirect per affected page so those in-body links keep
  // resolving instead of 404ing after migration.
  const segmentAliasRedirects = context.segmentAliases.size > 0
    ? context.descriptors.flatMap((descriptor) => {
        const segments = descriptor.navigationId.split('/')
        let changed = false
        const aliased = segments.map((segment) => {
          const literal = context.segmentAliases.get(segment)
          if (!literal) return segment
          changed = true
          return literal
        })
        if (!changed) return []
        const source = `/${aliased.join('/')}`
        if (source === `/${descriptor.navigationId}` || knownIds.has(aliased.join('/'))) return []
        return [{ source, destination: `/${descriptor.navigationId}` }]
      })
    : []
  const allRedirects = [
    ...redirects,
    ...context.bareRouteRedirects.filter((redirect) => !authoredSources.has(redirect.source)),
    ...segmentAliasRedirects.filter((redirect) => !authoredSources.has(redirect.source)),
  ]

  // Two `api:` nodes both nested under the same top-level tab (e.g.
  // Paradex's "Production API Reference" and "Testnet API Reference"
  // sections, both inside a `portal` tab) get the same `tabLabel` from the
  // loop above — Thally's schema allows only one `.api` per tab, so the
  // second would otherwise silently overwrite the first tab's binding.
  // Disambiguate every collision after the fact (the first claimant keeps
  // the plain tab label) using the node's own section route, which is
  // exactly what differs between them.
  const claimedTabLabels = new Set<string>()
  const disambiguatedApiSections = context.apiSections.map((section) => {
    if (!section.tabLabel || !claimedTabLabels.has(section.tabLabel)) {
      if (section.tabLabel) claimedTabLabels.add(section.tabLabel)
      return section
    }
    const distinguishingSegment = section.routeSegments.at(-1)
    const tabLabel = distinguishingSegment ? `${section.tabLabel}: ${titleCase(distinguishingSegment)}` : section.tabLabel
    claimedTabLabels.add(tabLabel)
    return { ...section, tabLabel }
  })

  return {
    docsConfig: {
      tabs,
      ...(navbarLinks.length > 0 ? { navbar: { links: navbarLinks } } : {}),
      ...(allRedirects.length > 0 ? { redirects: allRedirects } : {}),
    },
    descriptors: context.descriptors,
    warnings: context.warnings,
    apiSections: disambiguatedApiSections,
  }
}
