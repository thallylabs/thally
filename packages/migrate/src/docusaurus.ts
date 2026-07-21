/**
 * Static Docusaurus repository projection. Sidebar modules are attacker-owned
 * source files, so this adapter reads only JSON5-compatible object literals and
 * never imports, evaluates, or executes JavaScript/TypeScript configuration.
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { extname, posix } from 'node:path'

import JSON5 from 'json5'
import { parse as parseYaml } from 'yaml'

import type { MarkdownPageIdentity } from './mdx.js'
import { pageIdFromReference, resolveWithin, slugifySegment } from './path.js'
import type {
  MigrationDocsConfig,
  MigrationNavigationGroup,
  MigrationPage,
  MigrationWarning,
} from './types.js'

const MAX_CONFIG_BYTES = 1_000_000
const CATEGORY_FILENAMES = ['_category_.json', '_category_.yml', '_category_.yaml']
const SIDEBAR_FILENAMES = [
  'sidebars.json',
  'sidebars.js',
  'sidebars.cjs',
  'sidebars.mjs',
  'sidebars.ts',
]

export interface DocusaurusPageDescriptor {
  sourcePath: string
  docId: string
  navigationId: string
  sidebarPosition?: number
  title: string
}

export interface DocusaurusSidebars {
  config: Record<string, unknown>
  sourcePath: string
}

export interface DocusaurusNavigationResult {
  docsConfig: MigrationDocsConfig
  generatedPages: Array<MigrationPage>
  referencedNavigationIds: Set<string>
  warnings: Array<MigrationWarning>
}

interface ProjectionContext {
  contentRoot: string
  descriptors: Array<DocusaurusPageDescriptor>
  descriptorByDocId: Map<string, DocusaurusPageDescriptor>
  generatedPages: Array<MigrationPage>
  generatedIds: Set<string>
  referencedNavigationIds: Set<string>
  sourceUrl: string
  routePrefix: string
  sidebarSource: string
  warnings: Array<MigrationWarning>
}

interface CategoryMetadata {
  label?: string
  position?: number
  link?: unknown
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stripNumberPrefix(value: string): string {
  return value.replace(/^\d+[-_]+/, '')
}

function normalizeDocId(value: string): string {
  return value
    .split(/[?#]/, 1)[0]
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.(?:mdx?)$/i, '')
    .split('/')
    .filter(Boolean)
    .map(stripNumberPrefix)
    .join('/')
}

function docusaurusSlugifySegment(value: string): string {
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    // Malformed escapes remain literal input and are normalized safely below.
  }
  return decoded
    .replace(/\.(?:html?|mdx?)$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function docusaurusRouteId(value: string): string | null {
  const segments = normalizeDocId(value)
    .split('/')
    .map(docusaurusSlugifySegment)
    .filter(Boolean)
  return segments.join('/') || 'introduction'
}

function defaultDocusaurusRouteId(value: string): string | null {
  const segments = normalizeDocId(value).split('/').filter(Boolean)
  if (/^(?:index|readme)$/i.test(segments.at(-1) ?? '')) segments.pop()
  const normalized = segments.map(docusaurusSlugifySegment).filter(Boolean)
  return normalized.join('/') || 'introduction'
}

function storageIdForRoute(routeId: string): string {
  return /(?:^|\/)(?:index|readme)$/i.test(routeId) ? `${routeId}/index` : routeId
}

function titleCase(value: string): string {
  return stripNumberPrefix(value)
    .replace(/sidebar$/i, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => ['api', 'cli', 'sdk', 'ui'].includes(word.toLowerCase())
      ? word.toUpperCase()
      : word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function routeFromSlug(slug: string, fallback: string, sourceDirectory?: string): string | null {
  if (slug === '/') return 'introduction'
  if (slug.startsWith('/')) return docusaurusRouteId(slug)
  const fallbackDirectory = sourceDirectory ?? (fallback === 'introduction' ? '' : posix.dirname(fallback))
  const resolved = posix.normalize(posix.join(fallbackDirectory, slug))
  if (resolved === '..' || resolved.startsWith('../')) return null
  return docusaurusRouteId(resolved)
}

/** Resolve Docusaurus `id`, `slug`, and numeric-prefix semantics once. */
export function resolveDocusaurusPageIdentity(
  sourcePath: string,
  frontmatter: Record<string, unknown>,
  fallback: MarkdownPageIdentity,
): { identity: MarkdownPageIdentity; descriptor: Omit<DocusaurusPageDescriptor, 'title'> } {
  const sourceDocId = normalizeDocId(sourcePath)
  const sourceDirectory = posix.dirname(sourceDocId)
  const configuredId = typeof frontmatter.id === 'string' && frontmatter.id.trim()
    ? stripNumberPrefix(frontmatter.id.trim())
    : null
  const docId = configuredId
    ? normalizeDocId(sourceDirectory === '.' ? configuredId : posix.join(sourceDirectory, configuredId))
    : sourceDocId
  // Docusaurus collapses a source `index` document by default, but an explicit
  // `slug: index` remains a literal route. Keep those two cases distinct.
  const defaultNavigationId = defaultDocusaurusRouteId(docId) ?? fallback.navigationId
  const configuredSlug = typeof frontmatter.slug === 'string' ? frontmatter.slug.trim() : ''
  const navigationId = configuredSlug
    ? routeFromSlug(
        configuredSlug,
        defaultNavigationId,
        sourceDirectory === '.' ? '' : sourceDirectory,
      ) ?? defaultNavigationId
    : defaultNavigationId
  const position = typeof frontmatter.sidebar_position === 'number'
    && Number.isFinite(frontmatter.sidebar_position)
    ? frontmatter.sidebar_position
    : undefined
  return {
    identity: { id: storageIdForRoute(navigationId), navigationId },
    descriptor: {
      sourcePath: sourcePath.replace(/\\/g, '/'),
      docId,
      navigationId,
      ...(position === undefined ? {} : { sidebarPosition: position }),
    },
  }
}

function sourceReferenceKey(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.(?:mdx?)$/i, '').replace(/\/$/, '')
}

/**
 * Rewrite Docusaurus file/doc-id links after every final slug is known. This is
 * deliberately line based so examples inside fenced code remain byte-for-byte
 * source content.
 */
export function rewriteDocusaurusLinks(
  body: string,
  current: DocusaurusPageDescriptor,
  descriptors: Array<DocusaurusPageDescriptor>,
): string {
  const routes = new Map<string, string>()
  for (const descriptor of descriptors) {
    const sourceKey = sourceReferenceKey(descriptor.sourcePath)
    routes.set(sourceKey, descriptor.navigationId)
    routes.set(sourceReferenceKey(descriptor.docId), descriptor.navigationId)
    routes.set(sourceReferenceKey(descriptor.navigationId), descriptor.navigationId)
    const sourceRoute = pageIdFromReference(sourceKey)
    if (sourceRoute) routes.set(sourceRoute, descriptor.navigationId)
  }
  const currentDirectory = posix.dirname(sourceReferenceKey(current.sourcePath))

  function rewriteTarget(target: string): string {
    if (!target || target.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return target
    const suffixIndex = target.search(/[?#]/)
    const path = suffixIndex >= 0 ? target.slice(0, suffixIndex) : target
    const suffix = suffixIndex >= 0 ? target.slice(suffixIndex) : ''
    const candidates = path.startsWith('/')
      ? [sourceReferenceKey(path), sourceReferenceKey(path).replace(/^docs\//, '')]
      : [
          sourceReferenceKey(posix.normalize(posix.join(currentDirectory, path))),
          sourceReferenceKey(path),
        ]
    const route = candidates.map((candidate) => routes.get(candidate)).find(Boolean)
    if (!route) return target
    return `${route === 'introduction' ? '/' : `/${route}`}${suffix}`
  }

  let codeFence: string | null = null
  return body.split('\n').map((line) => {
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (!codeFence) codeFence = fence[1][0]
      else if (fence[1][0] === codeFence) codeFence = null
      return line
    }
    if (codeFence) return line
    return line
      .replace(/(\]\()([^\s)]+)(?=[\s)]|$)/g, (_match, prefix: string, target: string) => `${prefix}${rewriteTarget(target)}`)
      .replace(/(\bhref=")([^"]+)(")/g, (_match, prefix: string, target: string, suffix: string) => `${prefix}${rewriteTarget(target)}${suffix}`)
  }).join('\n')
}

function readBoundedText(path: string): string {
  if (lstatSync(path).size > MAX_CONFIG_BYTES) {
    throw new Error('Docusaurus sidebar config exceeded the 1 MB static-parser limit.')
  }
  return readFileSync(path, 'utf8')
}

function matchingObjectLiteral(source: string, start: number): string | null {
  let depth = 0
  let quote: string | null = null
  let isEscaped = false
  let lineComment = false
  let blockComment = false
  let objectStart = -1

  for (let index = start; index < source.length; index++) {
    const char = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index++
      }
      continue
    }
    if (quote) {
      if (isEscaped) isEscaped = false
      else if (char === '\\') isEscaped = true
      else if (char === quote) quote = null
      continue
    }
    if (char === '/' && next === '/') {
      lineComment = true
      index++
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index++
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{') {
      if (objectStart < 0) objectStart = index
      depth++
    } else if (char === '}' && objectStart >= 0) {
      depth--
      if (depth === 0) return source.slice(objectStart, index + 1)
    } else if (objectStart < 0 && !/\s/.test(char)) {
      return null
    }
  }
  return null
}

function parseStaticSidebarModule(source: string): Record<string, unknown> {
  const bindings = new Map<string, Record<string, unknown>>()
  const normalizedSource = replaceExternalFbContent(source)
  const parseFailures: Array<string> = []
  const assignmentPatterns = [
    /\bmodule\.exports\s*=\s*/g,
    /\bexport\s+default\s*/g,
    /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*:\s*[^=;]+)?\s*=\s*/g,
  ]
  const candidates = assignmentPatterns.flatMap((pattern) => [...normalizedSource.matchAll(pattern)])
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))

  for (const candidate of candidates) {
    const literal = matchingObjectLiteral(normalizedSource, (candidate.index ?? 0) + candidate[0].length)
    if (!literal) continue
    try {
      const substituted = [...bindings].reduce(
        (value, [name, binding]) => value.replace(
          new RegExp(`(:\\s*)${name}\\b`, 'g'),
          (_match, prefix: string) => `${prefix}${JSON.stringify(binding)}`,
        ),
        literal,
      )
      const parsed = JSON5.parse(substituted) as unknown
      const object = objectValue(parsed)
      if (!object) continue
      const bindingName = candidate[0].match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/)?.[1]
      if (bindingName) {
        bindings.set(bindingName, object)
        continue
      }
      return object
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const line = Number(message.match(/at (\d+):/)?.[1] ?? 0)
      const context = line > 0 ? literal.split('\n').slice(Math.max(0, line - 2), line + 1).join(' ') : ''
      parseFailures.push(`${message}${context ? ` near ${context}` : ''}`)
      // Try the next assignment. Expressions and function calls are rejected.
    }
  }
  const exportedBinding = normalizedSource.match(/\bexport\s+default\s+([A-Za-z_$][\w$]*)\b/)?.[1]
    ?? normalizedSource.match(/\bmodule\.exports\s*=\s*([A-Za-z_$][\w$]*)\b/)?.[1]
  if (exportedBinding && bindings.has(exportedBinding)) return bindings.get(exportedBinding)!
  throw new Error(`Sidebar config is executable or outside the supported data-only syntax.${parseFailures[0] ? ` ${parseFailures[0]}` : ''}`)
}

function replaceExternalFbContent(source: string): string {
  const marker = '...fbContent('
  let result = source
  let searchFrom = 0
  while (true) {
    const start = result.indexOf(marker, searchFrom)
    if (start < 0) return result.replace(/,\s*,/g, ',')
    const objectStart = result.indexOf('{', start + marker.length)
    if (objectStart < 0) return result
    const objectLiteral = matchingObjectLiteral(result, objectStart)
    if (!objectLiteral) {
      searchFrom = start + marker.length
      continue
    }
    const objectEnd = objectStart + objectLiteral.length
    const close = result.indexOf(')', objectEnd)
    if (close < 0) return result
    const externalMatch = /\bexternal\s*:\s*/g.exec(objectLiteral)
    let replacement = ''
    if (externalMatch) {
      const arrayStart = objectLiteral.indexOf('[', externalMatch.index + externalMatch[0].length)
      if (arrayStart >= 0) {
        const array = matchingArrayLiteral(objectLiteral, arrayStart)
        if (array) replacement = array.slice(1, -1)
      }
    }
    let replaceEnd = close + 1
    if (!replacement) {
      const trailingComma = result.slice(replaceEnd).match(/^\s*,/)
      if (trailingComma) replaceEnd += trailingComma[0].length
    }
    result = `${result.slice(0, start)}${replacement}${result.slice(replaceEnd)}`
    searchFrom = start + replacement.length
  }
}

function matchingArrayLiteral(source: string, start: number): string | null {
  let depth = 0
  let quote = ''
  let isEscaped = false
  for (let index = start; index < source.length; index++) {
    const character = source[index]
    if (quote) {
      if (isEscaped) isEscaped = false
      else if (character === '\\') isEscaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '[') depth++
    if (character === ']' && --depth === 0) return source.slice(start, index + 1)
  }
  return null
}

function configuredSidebarPath(repositoryRoot: string): string | null {
  for (const filename of ['docusaurus.config.js', 'docusaurus.config.ts', 'docusaurus.config.mjs']) {
    const path = resolveWithin(repositoryRoot, filename)
    if (!existsSync(path)) continue
    const source = readBoundedText(path)
    const match = source.match(/\bsidebarPath\s*:\s*(?:require\.resolve\(\s*)?(['"])([^'"]+)\1/)
    if (!match) continue
    const candidate = match[2].replace(/^\.\//, '')
    const resolved = resolveWithin(repositoryRoot, candidate)
    if (existsSync(resolved) && lstatSync(resolved).isFile()) return candidate
  }
  return null
}

/** Read the configured/default sidebar without running the source module. */
export function readDocusaurusSidebars(repositoryRoot: string): DocusaurusSidebars | null {
  const configured = configuredSidebarPath(repositoryRoot)
  const sourcePath = [configured, ...SIDEBAR_FILENAMES]
    .filter((value): value is string => Boolean(value))
    .find((candidate) => existsSync(resolveWithin(repositoryRoot, candidate)))
  if (!sourcePath) return null
  const absolutePath = resolveWithin(repositoryRoot, sourcePath)
  const source = readBoundedText(absolutePath)
  const parsed = extname(sourcePath).toLowerCase() === '.json'
    ? objectValue(JSON5.parse(source))
    : parseStaticSidebarModule(source)
  if (!parsed) throw new Error('Docusaurus sidebar config must export an object.')
  return { config: parsed, sourcePath }
}

function readCategoryMetadata(contentRoot: string, directory: string): CategoryMetadata {
  for (const filename of CATEGORY_FILENAMES) {
    const path = resolveWithin(contentRoot, posix.join(directory, filename))
    if (!existsSync(path) || !lstatSync(path).isFile()) continue
    try {
      const raw = readBoundedText(path)
      const parsed = filename.endsWith('.json') ? JSON5.parse(raw) : parseYaml(raw)
      const object = objectValue(parsed)
      if (!object) return {}
      return {
        ...(typeof object.label === 'string' ? { label: object.label } : {}),
        ...(typeof object.position === 'number' ? { position: object.position } : {}),
        ...('link' in object ? { link: object.link } : {}),
      }
    } catch {
      return {}
    }
  }
  return {}
}

function descriptorSort(left: DocusaurusPageDescriptor, right: DocusaurusPageDescriptor): number {
  const leftPosition = left.sidebarPosition ?? Number.MAX_SAFE_INTEGER
  const rightPosition = right.sidebarPosition ?? Number.MAX_SAFE_INTEGER
  if (leftPosition !== rightPosition) return leftPosition - rightPosition
  return left.sourcePath.localeCompare(right.sourcePath, undefined, { numeric: true })
}

function registerDoc(docId: string, context: ProjectionContext): string | null {
  const key = normalizeDocId(docId)
  const descriptor = context.descriptorByDocId.get(key)
    ?? context.descriptors.find((page) => page.navigationId === docusaurusRouteId(key))
  if (!descriptor) {
    context.warnings.push({
      code: 'missing-page',
      message: 'A Docusaurus sidebar document did not resolve to an imported page.',
      source: docId,
    })
    return null
  }
  context.referencedNavigationIds.add(descriptor.navigationId)
  return descriptor.navigationId
}

function generatedIndexPage(
  label: string,
  linkValue: unknown,
  context: ProjectionContext,
): string | null {
  const link = objectValue(linkValue)
  if (!link) return null
  if (link.type === 'doc' && typeof link.id === 'string') return registerDoc(link.id, context)
  if (link.type !== 'generated-index') return null
  const fallback = `category/${slugifySegment(label)}`
  const unprefixedNavigationId = typeof link.slug === 'string'
    ? routeFromSlug(link.slug, fallback) ?? fallback
    : fallback
  const navigationId = context.routePrefix
    && unprefixedNavigationId !== context.routePrefix
    && !unprefixedNavigationId.startsWith(`${context.routePrefix}/`)
    ? posix.join(context.routePrefix, unprefixedNavigationId)
    : unprefixedNavigationId
  if (!context.generatedIds.has(navigationId)
    && !context.descriptors.some((page) => page.navigationId === navigationId)) {
    const description = typeof link.description === 'string'
      ? link.description
      : `Browse the ${label} documentation.`
    context.generatedPages.push({
      id: storageIdForRoute(navigationId),
      navigationId,
      title: typeof link.title === 'string' ? link.title : label,
      description,
      keywords: Array.isArray(link.keywords)
        ? link.keywords.filter((value): value is string => typeof value === 'string')
        : [],
      body: description,
      source: `${context.sourceUrl}#${context.sidebarSource}`,
    })
    context.generatedIds.add(navigationId)
  }
  context.referencedNavigationIds.add(navigationId)
  return navigationId
}

function autogeneratedItems(dirName: string, context: ProjectionContext): Array<string | MigrationNavigationGroup> {
  const normalizedDir = dirName === '.' ? '' : normalizeDocId(dirName)
  const inDirectory = context.descriptors.filter((descriptor) => {
    const source = descriptor.sourcePath.replace(/\.(?:mdx?)$/i, '')
    return !normalizedDir || source === normalizedDir || source.startsWith(`${normalizedDir}/`)
  })
  const directPages: Array<DocusaurusPageDescriptor> = []
  const childDirectories = new Set<string>()
  for (const descriptor of inDirectory) {
    const source = descriptor.sourcePath.replace(/\.(?:mdx?)$/i, '')
    const relativePath = normalizedDir ? posix.relative(normalizedDir, source) : source
    const segments = relativePath.split('/').filter(Boolean)
    if (segments.length <= 1) directPages.push(descriptor)
    else childDirectories.add(segments[0])
  }

  const items: Array<string | MigrationNavigationGroup> = directPages
    .sort(descriptorSort)
    .map((descriptor) => {
      context.referencedNavigationIds.add(descriptor.navigationId)
      return descriptor.navigationId
    })
  const groups = [...childDirectories].map((segment) => {
    const directory = normalizedDir ? posix.join(normalizedDir, segment) : segment
    const metadata = readCategoryMetadata(context.contentRoot, directory)
    const pages = autogeneratedItems(directory, context)
    const landing = generatedIndexPage(metadata.label ?? titleCase(segment), metadata.link, context)
    if (landing && !pages.includes(landing)) pages.unshift(landing)
    return {
      position: metadata.position ?? Number.MAX_SAFE_INTEGER,
      segment,
      group: {
        group: metadata.label ?? titleCase(segment),
        pages,
      } satisfies MigrationNavigationGroup,
    }
  }).sort((left, right) => left.position - right.position
    || left.segment.localeCompare(right.segment, undefined, { numeric: true }))
  items.push(...groups.map((entry) => entry.group))
  return items
}

function convertItems(value: unknown, context: ProjectionContext): Array<string | MigrationNavigationGroup> {
  if (typeof value === 'string') {
    const page = registerDoc(value, context)
    return page ? [page] : []
  }
  if (Array.isArray(value)) return value.flatMap((entry) => convertItems(entry, context))
  const object = objectValue(value)
  if (!object) return []

  if (object.type === 'doc' || object.type === 'ref') {
    const page = typeof object.id === 'string' ? registerDoc(object.id, context) : null
    return page ? [page] : []
  }
  if (object.type === 'autogenerated') {
    return autogeneratedItems(typeof object.dirName === 'string' ? object.dirName : '.', context)
  }
  if (object.type === 'category') {
    const label = typeof object.label === 'string' ? object.label : 'Documentation'
    const pages = convertItems(object.items, context)
    const landing = generatedIndexPage(label, object.link, context)
    if (landing && !pages.includes(landing)) pages.unshift(landing)
    return pages.length > 0 ? [{ group: label, pages }] : []
  }
  if (object.type === 'link' || object.type === 'html') return []

  // Docusaurus category shorthand and sidebar slices are ordinary objects.
  return Object.entries(object).flatMap(([label, items]) => {
    const pages = convertItems(items, context)
    return pages.length > 0 ? [{ group: label, pages }] : []
  })
}

/** Project explicit and autogenerated Docusaurus sidebars into Thally tabs. */
export function projectDocusaurusNavigation(input: {
  sidebars: DocusaurusSidebars | null
  descriptors: Array<DocusaurusPageDescriptor>
  contentRoot: string
  sourceUrl: string
  routePrefix?: string
}): DocusaurusNavigationResult {
  const warnings: Array<MigrationWarning> = []
  const descriptorByDocId = new Map(input.descriptors.map((page) => [page.docId, page]))
  const context: ProjectionContext = {
    contentRoot: input.contentRoot,
    descriptors: input.descriptors,
    descriptorByDocId,
    generatedPages: [],
    generatedIds: new Set(),
    referencedNavigationIds: new Set(),
    sourceUrl: input.sourceUrl,
    routePrefix: input.routePrefix ?? '',
    sidebarSource: input.sidebars?.sourcePath ?? 'autogenerated sidebar',
    warnings,
  }
  const sidebarEntries = input.sidebars ? Object.entries(input.sidebars.config) : [['docs', [
    { type: 'autogenerated', dirName: '.' },
  ]]]
  const tabs = sidebarEntries.flatMap(([sidebarId, value]) => {
    const converted = convertItems(value, context)
    const loosePages = converted.filter((entry): entry is string => typeof entry === 'string')
    const groups = converted.filter((entry): entry is MigrationNavigationGroup => typeof entry !== 'string')
    if (loosePages.length > 0) groups.unshift({ group: 'Overview', pages: loosePages })
    if (groups.length === 0) return []
    return [{
      tab: sidebarEntries.length === 1 ? 'Documentation' : titleCase(sidebarId),
      groups,
    }]
  })

  const unreferenced = input.descriptors
    .filter((page) => !context.referencedNavigationIds.has(page.navigationId))
    .sort(descriptorSort)
    .map((page) => page.navigationId)
  if (unreferenced.length > 0) {
    if (tabs.length === 0) tabs.push({ tab: 'Documentation', groups: [] })
    tabs[0].groups?.push({ group: 'Additional', pages: unreferenced })
  }
  return {
    docsConfig: { tabs },
    generatedPages: context.generatedPages,
    referencedNavigationIds: context.referencedNavigationIds,
    warnings,
  }
}
