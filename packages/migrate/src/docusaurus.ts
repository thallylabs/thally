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
import { isRedirectPathSafe } from './navigation.js'
import { pageIdFromReference, resolveWithin, slugifySegment } from './path.js'
import type {
  MigrationDocsConfig,
  MigrationNavigationGroup,
  MigrationPage,
  MigrationWarning,
} from './types.js'

const MAX_CONFIG_BYTES = 20_000_000
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
 * source content. A link whose `#fragment` uses a case-preserved heading id
 * (live Docusaurus keeps case intact; Thally always lowercases its auto-slug)
 * is left as-is here — `preserveDocusaurusLinkedAnchors` (repository.ts)
 * repairs those afterward by adding an explicit anchor matching the literal
 * fragment, which also covers repeated table-field ids that this
 * path-only resolver has no visibility into.
 */
export function rewriteDocusaurusLinks(
  body: string,
  current: DocusaurusPageDescriptor,
  descriptors: Array<DocusaurusPageDescriptor>,
  options: { sourceOrigin?: string; onExternalLink?: (target: string) => void } = {},
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
    if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return target
    if (target.startsWith('#')) return target
    const suffixIndex = target.search(/[?#]/)
    const path = suffixIndex >= 0 ? target.slice(0, suffixIndex) : target
    const suffix = suffixIndex >= 0 ? target.slice(suffixIndex) : ''
    const candidates = path.startsWith('/')
      ? [
          sourceReferenceKey(path),
          sourceReferenceKey(path).replace(/^docs\//, ''),
          sourceReferenceKey(path).replace(/^docs\/(?:next|current|latest)\//, ''),
        ]
      : [
          sourceReferenceKey(posix.normalize(posix.join(currentDirectory, path))),
          sourceReferenceKey(path),
        ]
    const route = candidates.map((candidate) => routes.get(candidate)).find(Boolean)
    if (!route) {
      if (path.startsWith('/') && path !== '/' && options.sourceOrigin) {
        options.onExternalLink?.(target)
        return new URL(target, options.sourceOrigin).toString()
      }
      return target
    }
    return `${route === 'introduction' ? '/' : `/${route}`}${suffix}`
  }

  let codeFence: string | null = null
  return body.split('\n').map((line) => {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fence) {
      if (!codeFence) codeFence = fence[1]
      else if (fence[1][0] === codeFence[0] && fence[1].length >= codeFence.length
        && /^\s*$/.test(line.slice(fence[0].length))) codeFence = null
      return line
    }
    if (codeFence) return line
    return line
      .replace(/(\]\()([^\s)]+)(?=[\s)]|$)/g, (_match, prefix: string, target: string) => `${prefix}${rewriteTarget(target)}`)
      .replace(/(\bhref=")([^"]+)(")/g, (_match, prefix: string, target: string, suffix: string) => `${prefix}${rewriteTarget(target)}${suffix}`)
      // Markdown reference links carry their destination in a later
      // definition line. Docusaurus resolves `[label]` through that line, so
      // rewriting only inline links leaves an apparently working link in the
      // content whose click still goes to `/page.md` and 404s on Thally.
      .replace(/^(\s{0,3}\[[^\]]+\]:\s*)(<[^>]+>|\S+)/, (_match, prefix: string, destination: string) => {
        const bracketed = destination.startsWith('<') && destination.endsWith('>')
        const target = bracketed ? destination.slice(1, -1) : destination
        const rewritten = rewriteTarget(target)
        return `${prefix}${bracketed ? `<${rewritten}>` : rewritten}`
      })
  }).join('\n')
}

/** Read a static Docusaurus site origin for links outside imported docs. */
export function readDocusaurusSiteOrigin(repositoryRoot: string): string | undefined {
  const configPath = findDocusaurusConfigPath(repositoryRoot)
  if (!configPath) return undefined
  const address = readBoundedText(configPath).match(/\burl['"]?\s*:\s*(['"])(https?:\/\/[^'"]+)\1/)?.[2]
  if (!address) return undefined
  try {
    return new URL(address).origin
  } catch {
    return undefined
  }
}

function readBoundedText(path: string): string {
  if (lstatSync(path).size > MAX_CONFIG_BYTES) {
    throw new Error('Docusaurus sidebar config exceeded the 20 MB static-parser limit.')
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
    // A site can register other docs plugins before the classic preset. Their
    // sidebarPath belongs to a different content root (Docusaurus registers
    // its community plugin before the main docs preset, for example).
    for (const docs of source.matchAll(/\bdocs\s*:\s*/g)) {
      const object = matchingObjectLiteral(source, (docs.index ?? 0) + docs[0].length)
      const candidate = object && staticStringField(object, 'sidebarPath')?.replace(/^\.\//, '')
      if (candidate) {
        const resolved = resolveWithin(repositoryRoot, candidate)
        if (existsSync(resolved) && lstatSync(resolved).isFile()) return candidate
      }
    }
    const match = source.match(/\bsidebarPath\s*:\s*(?:require\.resolve\(\s*)?(['"])([^'"]+)\1/)
    if (!match) continue
    const candidate = match[2].replace(/^\.\//, '')
    const resolved = resolveWithin(repositoryRoot, candidate)
    if (existsSync(resolved) && lstatSync(resolved).isFile()) return candidate
  }
  return null
}

/** Read the configured/default sidebar without running the source module. */
export function readDocusaurusSidebars(repositoryRoot: string, versionedSidebarPath?: string): DocusaurusSidebars | null {
  // Archived versions carry their own sidebar file. Resolve it within the
  // project and parse it as data; never load source-controlled code.
  const configured = versionedSidebarPath ?? configuredSidebarPath(repositoryRoot)
  const sourcePath = [configured, ...(versionedSidebarPath ? [] : SIDEBAR_FILENAMES)]
    .filter((value): value is string => Boolean(value))
    .find((candidate) => {
      const path = resolveWithin(repositoryRoot, candidate)
      return existsSync(path) && lstatSync(path).isFile()
    })
  if (!sourcePath) return null
  const absolutePath = resolveWithin(repositoryRoot, sourcePath)
  const source = readBoundedText(absolutePath)
  const parsed = extname(sourcePath).toLowerCase() === '.json'
    ? objectValue(JSON5.parse(source))
    : parseStaticSidebarModule(source)
  if (!parsed) throw new Error('Docusaurus sidebar config must export an object.')
  return { config: parsed, sourcePath }
}

function namedExportObjectLiteralText(source: string, name: string): string | null {
  const normalizedSource = replaceExternalFbContent(source)
  const match = new RegExp(`\\bexport\\s+(?:const|let|var)\\s+${name}\\b(?:\\s*:\\s*[^=;]+)?\\s*=\\s*`).exec(normalizedSource)
  if (!match) return null
  return matchingObjectLiteral(normalizedSource, match.index + match[0].length)
}

/**
 * Pluck just the `redirects: [...]` array out of a plugin options object's
 * literal text, rather than `JSON5.parse`-ing the whole object — the Oasis
 * shape (a real, reproduced example) has a sibling `createRedirects(...) {
 * ... }` method in the same object literal, which is not valid JSON5 and
 * would otherwise fail the whole object and lose the `redirects` array too.
 */
function redirectEntriesFromObjectLiteralText(objectLiteral: string): Array<{ source: string; destination: string }> {
  const match = /\bredirects\s*:\s*/.exec(objectLiteral)
  if (!match) return []
  const arrayStart = objectLiteral.indexOf('[', match.index + match[0].length)
  if (arrayStart < 0) return []
  const arrayLiteral = matchingArrayLiteral(objectLiteral, arrayStart)
  if (!arrayLiteral) return []
  let parsed: unknown
  try {
    parsed = JSON5.parse(arrayLiteral)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const entries: Array<{ source: string; destination: string }> = []
  for (const raw of parsed) {
    const entry = objectValue(raw)
    if (!entry || typeof entry.to !== 'string') continue
    const froms = Array.isArray(entry.from) ? entry.from : [entry.from]
    for (const from of froms) {
      if (typeof from !== 'string') continue
      if (!isRedirectPathSafe(from, entry.to)) continue
      entries.push({ source: from, destination: entry.to })
    }
  }
  return entries
}

/**
 * Parse a `@docusaurus/plugin-client-redirects` `Options` object: either an
 * object literal written inline in the plugin's config entry, or (Oasis's
 * shape) a named export in a separate module the config imports, e.g.
 * `redirects.ts` exporting `redirectsOptions`. Only a literal `redirects:
 * [{ from, to }]` array is understood — `from` may be a single path or an
 * array of paths, both valid per the plugin's own docs. Its `createRedirects`
 * function computes redirects dynamically and can't be evaluated statically,
 * so its presence is warned about rather than silently ignored.
 */
export function readDocusaurusRedirects(
  repositoryRoot: string,
  warnings: Array<MigrationWarning>,
): Array<{ source: string; destination: string }> {
  const configPath = findDocusaurusConfigPath(repositoryRoot)
  if (!configPath) return []
  const configSource = readBoundedText(configPath)
  const pluginMatch = /['"]@docusaurus\/plugin-client-redirects['"]\s*,\s*/.exec(configSource)
  if (!pluginMatch) return []
  const afterPlugin = configSource.slice(pluginMatch.index + pluginMatch[0].length)
  const warnAboutCreateRedirects = (source: string): void => {
    if (!/\bcreateRedirects\s*[:(]/.test(source)) return
    warnings.push({
      code: 'unsupported-config',
      message: "The redirects plugin's createRedirects function computes redirects dynamically and cannot be evaluated during migration; add its redirects manually.",
    })
  }
  warnAboutCreateRedirects(configSource)
  // Case 1: the plugin's options object is written inline.
  const inlineLiteral = matchingObjectLiteral(configSource, pluginMatch.index + pluginMatch[0].length)
  if (inlineLiteral) return redirectEntriesFromObjectLiteralText(inlineLiteral)
  // Case 2: the options are an identifier imported from another module.
  const identifier = afterPlugin.match(/^([A-Za-z_$][\w$]*)/)?.[1]
  if (!identifier) return []
  const importMatch = new RegExp(`import\\s*\\{[^}]*\\b${identifier}\\b[^}]*\\}\\s*from\\s*(['"])([^'"]+)\\1`).exec(configSource)
    ?? new RegExp(`import\\s+${identifier}\\s+from\\s*(['"])([^'"]+)\\1`).exec(configSource)
  const modulePath = importMatch?.[2]
  if (!modulePath || !modulePath.startsWith('.')) return []
  let resolvedPath: string | undefined
  try {
    resolvedPath = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs']
      .map((extension) => resolveWithin(repositoryRoot, `${modulePath.replace(/^\.\//, '')}${extension}`))
      .find((candidate) => existsSync(candidate) && lstatSync(candidate).isFile())
  } catch {
    return []
  }
  if (!resolvedPath) return []
  const moduleSource = readBoundedText(resolvedPath)
  warnAboutCreateRedirects(moduleSource)
  const literal = namedExportObjectLiteralText(moduleSource, identifier)
  return literal ? redirectEntriesFromObjectLiteralText(literal) : []
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

const DOCUSAURUS_HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/

function findDocusaurusConfigPath(repositoryRoot: string): string | null {
  return ['docusaurus.config.js', 'docusaurus.config.ts', 'docusaurus.config.mjs']
    .map((filename) => resolveWithin(repositoryRoot, filename))
    .find((candidate) => existsSync(candidate) && lstatSync(candidate).isFile()) ?? null
}

/**
 * Extract a static `--ifm-color-primary` accent from the classic theme's
 * `customCss` file (Infima's own theming convention: a `:root` block for
 * light mode, an `html[data-theme='dark']` block for dark mode). Its
 * `light`/`dark` blocks are normal, like Fern's (unlike Mintlify's inverted
 * schema `site.colors` otherwise follows), so they're swapped the same way
 * `fernThemeColors` does to give downstream consumers one consistent
 * contract.
 */
export function readDocusaurusThemeColor(repositoryRoot: string): { light?: string; dark?: string } | undefined {
  const configPath = findDocusaurusConfigPath(repositoryRoot)
  if (!configPath) return undefined
  const configSource = readBoundedText(configPath)
  const cssRelativePath = configSource.match(/\bcustomCss\s*:\s*(?:\[\s*)?(?:require\.resolve\(\s*)?(['"])([^'"]+)\1/)?.[2]
  if (!cssRelativePath) return undefined
  let cssPath: string
  try {
    cssPath = resolveWithin(repositoryRoot, cssRelativePath.replace(/^\.\//, ''))
  } catch {
    return undefined
  }
  if (!existsSync(cssPath) || !lstatSync(cssPath).isFile()) return undefined
  const css = readBoundedText(cssPath)
  const pick = (block: string | undefined): string | undefined => {
    const value = block?.match(/--ifm-color-primary\s*:\s*([^;]+);/)?.[1]?.trim()
    return value && DOCUSAURUS_HEX_COLOR.test(value) ? value : undefined
  }
  const lightMode = pick(css.match(/:root\s*\{([^}]*)\}/)?.[1])
  const darkMode = pick(css.match(/\[data-theme=(['"])dark\1\]\s*\{([^}]*)\}/)?.[2])
  const colors: { light?: string; dark?: string } = {}
  if (darkMode) colors.light = darkMode
  if (lightMode) colors.dark = lightMode
  return Object.keys(colors).length > 0 ? colors : undefined
}

export interface DocusaurusSiteSettings {
  name?: string
  description?: string
  logo?: { light: string; dark?: string; showTitle?: boolean }
  favicon?: string
  /** Docusaurus serves the classic docs plugin below /docs unless configured otherwise. */
  docsRouteBasePath: string
  navbarLinks: Array<{ label: string; href?: string; docId?: string; sidebarId?: string; docsPluginId?: string }>
  footerLinks: NonNullable<MigrationDocsConfig['footer']>['links']
  copyright?: string
}

function propertyStart(source: string, name: string): number {
  // Only property positions count. A bare word in a comment or a value must
  // never become executable configuration during repository migration.
  const pattern = new RegExp(`(?:^|[,{\\n])\\s*["']?${name}["']?\\s*:\\s*`, 'm')
  const match = pattern.exec(source)
  return match ? match.index + match[0].length : -1
}

function staticStringBindings(source: string): Map<string, string> {
  const bindings = new Map<string, string>()
  for (const match of source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))/g)) {
    try {
      const value = JSON5.parse(match[2]) as unknown
      if (typeof value === 'string') bindings.set(match[1], value)
    } catch {
      // Executable or malformed declarations cannot become imported links.
    }
  }
  return bindings
}

function staticArrayField(source: string, name: string): string | null {
  const start = propertyStart(source, name)
  return start < 0 ? null : matchingArrayLiteral(source, start)
}

function staticObjectEntries(array: string | null): Array<string> {
  if (!array) return []
  const entries: Array<string> = []
  let afterDelimiter = 1
  let quote = ''
  let lineComment = false
  let blockComment = false
  for (let index = 1; index < array.length - 1; index++) {
    const char = array[index]
    const next = array[index + 1]
    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index++ }
      continue
    }
    if (quote) {
      if (char === '\\') { index++; continue }
      if (char === quote) quote = ''
      continue
    }
    if (char === '/' && next === '/') { lineComment = true; index++; continue }
    if (char === '/' && next === '*') { blockComment = true; index++; continue }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === ',') { afterDelimiter = index + 1; continue }
    if (char !== '{') continue
    const literal = matchingObjectLiteral(array, index)
    if (!literal) continue
    const lead = array.slice(afterDelimiter, index)
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').trim()
    // `isDev && { ... }` is a conditional entry; never assume it appears in
    // production just because its object literal can be read statically.
    if (!lead) entries.push(literal)
    index += literal.length - 1
  }
  return entries
}

function staticStringField(source: string, name: string, bindings?: Map<string, string>): string | undefined {
  const start = propertyStart(source, name)
  if (start < 0) return undefined
  const quoted = source.slice(start).match(/^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/)
  if (!quoted) {
    const binding = source.slice(start).match(/^([A-Z][A-Z0-9_]*)\b/)?.[1]
    return binding ? bindings?.get(binding) : undefined
  }
  try {
    const parsed = JSON5.parse(quoted[1]) as unknown
    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Project Docusaurus' static site identity and footer without loading config code. */
export function readDocusaurusSiteSettings(repositoryRoot: string): DocusaurusSiteSettings {
  const empty: DocusaurusSiteSettings = { docsRouteBasePath: 'docs', navbarLinks: [], footerLinks: [] }
  const configPath = findDocusaurusConfigPath(repositoryRoot)
  if (!configPath) return empty
  const source = readBoundedText(configPath)
  const bindings = staticStringBindings(source)
  const presets = staticArrayField(source, 'presets')
  const classicDocs = presets && [...presets.matchAll(/["']?docs["']?\s*:\s*/g)]
    .map((match) => matchingObjectLiteral(presets, (match.index ?? 0) + match[0].length))
    .find((object): object is string => Boolean(object))
  const docsRouteBasePath = classicDocs && staticStringField(classicDocs, 'routeBasePath') || 'docs'
  const themeStart = propertyStart(source, 'themeConfig')
  const theme = themeStart < 0 ? null : matchingObjectLiteral(source, themeStart)
  const navbarStart = theme ? propertyStart(theme, 'navbar') : -1
  const navbar = navbarStart < 0 ? null : matchingObjectLiteral(theme!, navbarStart)
  const logoStart = navbar ? propertyStart(navbar, 'logo') : -1
  const logo = logoStart < 0 ? null : matchingObjectLiteral(navbar!, logoStart)
  const footerStart = theme ? propertyStart(theme, 'footer') : -1
  const footer = footerStart < 0 ? null : matchingObjectLiteral(theme!, footerStart)
  const navbarLinks = navbar ? staticObjectEntries(staticArrayField(navbar, 'items')).flatMap((item) => {
    // A dropdown owns nested links but no single destination. Taking its
    // first child as the parent's href creates duplicate, misleading links.
    if (propertyStart(item, 'items') >= 0 || propertyStart(item, 'dropdownItemsAfter') >= 0) return []
    const docsPluginId = staticStringField(item, 'docsPluginId', bindings)
    const href = staticStringField(item, 'to', bindings)
      ?? staticStringField(item, 'href', bindings)
    const docId = staticStringField(item, 'docId', bindings)
    const sidebarId = staticStringField(item, 'sidebarId', bindings)
    const label = staticStringField(item, 'label', bindings) ?? staticStringField(item, 'aria-label', bindings)
    return label && (href || docId || sidebarId || docsPluginId)
      ? [{ label, ...(href ? { href } : {}), ...(docId ? { docId } : {}),
        ...(sidebarId ? { sidebarId } : {}), ...(docsPluginId ? { docsPluginId } : {}) }]
      : []
  }) : []
  const footerLinks = footer ? staticObjectEntries(staticArrayField(footer, 'links')).flatMap((column) => {
    const heading = staticStringField(column, 'title', bindings)
    if (!heading) return []
    const items = staticObjectEntries(staticArrayField(column, 'items')).flatMap((item) => {
      const href = staticStringField(item, 'to', bindings) ?? staticStringField(item, 'href', bindings)
      const label = staticStringField(item, 'label', bindings)
      return label && href
        ? [{ label, href }]
        : []
    })
    return items.length > 0 ? [{ heading, items }] : []
  }) : []
  // A build-time year expression is the one dynamic Docusaurus copyright
  // pattern that can be represented without evaluating source JavaScript.
  const copyright = footer && propertyStart(footer, 'copyright') >= 0
    ? staticStringField(footer, 'copyright')
      ?? footer.slice(propertyStart(footer, 'copyright')).match(/^`([^`]+)`/)?.[1]
        ?.replace(/\$\{new Date\(\)\.getFullYear\(\)\}/g, '{year}')
    : undefined
  return {
    name: staticStringField(source, 'title'),
    description: staticStringField(source, 'tagline'),
    docsRouteBasePath,
    ...(logo && staticStringField(logo, 'src') ? {
      logo: {
        light: staticStringField(logo, 'src')!,
        ...(staticStringField(logo, 'srcDark') ? { dark: staticStringField(logo, 'srcDark') } : {}),
        showTitle: Boolean(navbar && staticStringField(navbar, 'title')),
      },
    } : {}),
    ...(staticStringField(source, 'favicon') ? { favicon: staticStringField(source, 'favicon') } : {}),
    navbarLinks,
    footerLinks,
    ...(copyright ? { copyright } : {}),
  }
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
  const sidebarEntries: Array<[string, unknown]> = input.sidebars ? Object.entries(input.sidebars.config) : [['docs', [
    { type: 'autogenerated', dirName: '.' },
  ]]]
  const tabs = sidebarEntries.flatMap(([sidebarId, value]) => {
    const converted = convertItems(value, context)
    if (converted.length === 0) return []
    return [{
      tab: sidebarEntries.length === 1 ? 'Documentation' : titleCase(sidebarId),
      // Docusaurus categories are disclosures, including at the sidebar
      // root. Keeping them as Thally root nodes preserves their collapsed
      // state and the authored interleaving of documents and categories.
      pages: converted,
    }]
  })

  const unreferenced = input.descriptors
    .filter((page) => !context.referencedNavigationIds.has(page.navigationId))
    .sort(descriptorSort)
    .map((page) => page.navigationId)
  if (unreferenced.length > 0) {
    if (tabs.length === 0) tabs.push({ tab: 'Documentation', pages: [] })
    tabs[0].pages?.push({ group: 'Additional', pages: unreferenced })
  }
  return {
    docsConfig: { tabs },
    generatedPages: context.generatedPages,
    referencedNavigationIds: context.referencedNavigationIds,
    warnings,
  }
}
