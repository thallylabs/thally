/**
 * Public URL adapter for the shared migration engine. Discovery prefers
 * machine-readable Markdown and sitemaps, remains scoped to the submitted docs
 * path, then falls back to bounded navigation crawling and HTML extraction.
 */

import { load } from 'cheerio'
import TurndownService from 'turndown'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { parseMarkdownPage } from './mdx.js'
import { buildNavigationFromPages } from './navigation.js'
import { pageIdFromReference } from './path.js'
import type {
  MigrationBundle,
  MigrationFetcher,
  MigrationFetchResponse,
  MigrationPage,
  MigrationPlatform,
  MigrationWarning,
} from './types.js'

const DEFAULT_MAX_PAGES = 1_000
const DEFAULT_MAX_TOTAL_BYTES = 100_000_000
const MAX_DISCOVERED_URLS = 5_000
const MAX_LOCAL_RESPONSE_BYTES = 2_000_000
const MAX_SITEMAP_DOCUMENTS = 25
const PORTABLE_MDX_COMPONENTS = new Set([
  'Accordion', 'AccordionGroup', 'Badge', 'Callout', 'Card', 'CardGroup',
  'Check', 'CodeGroup', 'Color', 'Column', 'Columns', 'Danger', 'Error', 'Expandable',
  'File', 'Folder', 'Frame', 'Hero', 'Icon', 'Info', 'Latex', 'Mermaid',
  'Note', 'Panel', 'ParamField', 'Prompt', 'PromptAssistant', 'PromptUser',
  'RequestExample', 'ResponseExample', 'ResponseField', 'Step', 'Steps',
  'Tab', 'Tabs', 'Tile', 'TileGroup', 'Tip', 'Tooltip', 'Tree', 'Update',
  'View', 'Warning',
])
const LOCALE_CODES = new Set([
  'ar', 'cs', 'da', 'de', 'el', 'es', 'fi', 'fr', 'he', 'hi', 'hu', 'id',
  'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sv',
  'th', 'tr', 'uk', 'vi', 'zh', 'pt-br', 'zh-hans', 'zh-hant',
])
const PORTABLE_URL_PROPS = 'href|src|img|primaryHref|secondaryHref'

interface EmbeddedOpenApiFragment {
  method: string
  path: string
  document: Record<string, unknown>
}

export interface UrlMigrationOptions {
  sourceUrl: string
  fetcher?: MigrationFetcher
  maxPages?: number
  concurrency?: number
  maxTotalBytes?: number
}

/** Validate the transport-level shape of a docs URL; hosted callers add SSRF checks. */
export function validateMigrationUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter a complete documentation URL, including https://.')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Documentation imports support only HTTP and HTTPS URLs.')
  }
  if (url.username || url.password) throw new Error('Documentation URLs cannot contain credentials.')
  url.hash = ''
  return url
}

async function readResponseBody(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > MAX_LOCAL_RESPONSE_BYTES) throw new Error('A documentation response exceeded the 2 MB import limit.')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Array<Uint8Array> = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_LOCAL_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('A documentation response exceeded the 2 MB import limit.')
    }
    chunks.push(value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/** Fetch implementation for local CLI usage. Cloud injects its pinned network boundary. */
export const defaultMigrationFetcher: MigrationFetcher = async (url, request) => {
  const response = await fetch(url, {
    headers: {
      Accept: request.accept,
      'User-Agent': 'Thally-Migrate/1.0 (+https://thally.io)',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Documentation server returned ${response.status}.`)
  return {
    finalUrl: new URL(response.url),
    body: await readResponseBody(response),
    contentType: response.headers.get('content-type') ?? '',
    headers: Object.fromEntries(response.headers.entries()),
  }
}

function docsScopePath(source: URL): string {
  const path = source.pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return '/'
  const segments = path.split('/').filter(Boolean)
  return `/${segments.length > 1 ? segments[0] : segments.join('/')}`
}

function machineIndexScopePath(
  source: URL,
  documents: Array<MigrationFetchResponse | null>,
): string | null {
  const candidates = new Set<string>()
  for (const document of documents) {
    if (!document) continue
    const references = [...headerLinks(document)]
    if (/html/i.test(document.contentType)) {
      const $ = load(document.body)
      references.push(...$('link[href], a[href]')
        .map((_index, element) => $(element).attr('href') ?? '')
        .get()
        .filter((href) => /\/(?:llms(?:-full)?\.txt|sitemap\.xml)(?:[?#]|$)/i.test(href)))
    }
    for (const reference of references) {
      try {
        const indexUrl = new URL(reference, document.finalUrl)
        if (indexUrl.origin !== source.origin) continue
        const scope = indexUrl.pathname.replace(/\/(?:llms(?:-full)?\.txt|sitemap\.xml)$/i, '') || '/'
        if (isInScope(source, source, scope)) candidates.add(scope)
      } catch {
        // Malformed discovery hints are ignored just like malformed page links.
      }
    }
  }
  return [...candidates].sort((left, right) => right.length - left.length)[0] ?? null
}

function isInScope(url: URL, source: URL, scopePath: string): boolean {
  if (url.origin !== source.origin || !['http:', 'https:'].includes(url.protocol)) return false
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (scopePath === '/') return true
  return path === scopePath || path === `${scopePath}.md` || path.startsWith(`${scopePath}/`)
}

function normalizeCandidate(value: string, base: URL, source: URL, scopePath: string): URL | null {
  try {
    const url = new URL(value, base)
    url.hash = ''
    if (!isInScope(url, source, scopePath)) return null
    if (url.pathname.startsWith('/cdn-cgi/')) return null
    if (/\/(?:llms(?:-full)?|robots)\.txt$/i.test(url.pathname)
      || /\/sitemap\.xml$/i.test(url.pathname)) return null
    if (/\.(?:avif|bmp|gif|ico|jpe?g|mp[34]|pdf|png|svg|ya?ml|webm|webp|zip)$/i.test(url.pathname)
      || /\/(?:openapi|swagger|asyncapi)[^/]*\.json$/i.test(url.pathname)) return null
    return url
  } catch {
    return null
  }
}

function candidateIdentity(url: URL): string {
  const pathname = url.pathname.replace(/\.mdx?$/i, '').replace(/\/+$/, '') || '/'
  return `${url.origin}${pathname}${url.search}`
}

function pageIdForUrl(url: URL, scopePath: string): string | null {
  let path = url.pathname.replace(/\/+$/, '')
  if (scopePath !== '/') {
    if (path === `${scopePath}.md`) path = ''
    else if (path === scopePath) path = ''
    else if (path.startsWith(`${scopePath}/`)) path = path.slice(scopePath.length + 1)
  }
  return pageIdFromReference(path.replace(/^\/+/, '') || 'introduction')
}

function canonicalLocalizedPageId(id: string): string {
  const [segment, ...rest] = id.split('/')
  if (LOCALE_CODES.has(segment)) return rest.length > 0 ? id : `${segment}/introduction`
  for (const locale of LOCALE_CODES) {
    if (segment !== `${locale}-api-reference`) continue
    return [locale, 'api-reference', ...rest].join('/')
  }
  return id
}

function detectUrlPlatform(document: MigrationFetchResponse): MigrationPlatform {
  const headers = Object.entries(document.headers ?? {})
    .map(([key, value]) => `${key}:${value ?? ''}`)
    .join(' ')
  const value = `${document.body.slice(0, 200_000)} ${headers}`.toLowerCase()
  if (value.includes('__mintlify') || value.includes('/mintlify-assets/')
    || value.includes('x-mintlify-') || value.includes('/_mintlify/')) return 'mintlify'
  if (value.includes('docusaurus') || value.includes('__docusaurus')) return 'docusaurus'
  if (value.includes('gitbook') || value.includes('gitbook.io')) return 'gitbook'
  if (value.includes('nextra')) return 'nextra'
  if (value.includes('vitepress')) return 'vitepress'
  if (value.includes('starlight')) return 'starlight'
  return 'generic'
}

function plainDescription(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

function withoutFencedCode(body: string): string {
  let fenceCharacter = ''
  let fenceLength = 0
  return body.split('\n').map((line) => {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    if (match && !fenceCharacter) {
      fenceCharacter = match[1][0]
      fenceLength = match[1].length
      return ''
    }
    if (match && match[1][0] === fenceCharacter && match[1].length >= fenceLength
      && match[2].trim() === '') {
      fenceCharacter = ''
      fenceLength = 0
      return ''
    }
    return fenceCharacter ? '' : line
  }).join('\n')
}

function eventHandlerPropEnd(value: string, start: number): number | null {
  const opening = value[start]
  if (opening === '"' || opening === "'") {
    for (let index = start + 1; index < value.length; index += 1) {
      if (value[index] === opening && value[index - 1] !== '\\') return index + 1
    }
    return null
  }
  if (opening !== '{') {
    const match = value.slice(start).match(/^[^\s>]+/)
    return match ? start + match[0].length : null
  }
  let depth = 0
  let quote = ''
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return null
}

function stripEventHandlerProps(line: string): string {
  const matcher = /\s+on[A-Z][A-Za-z0-9]*\s*=\s*/g
  let cursor = 0
  let result = ''
  for (const match of line.matchAll(matcher)) {
    const start = match.index
    const valueStart = start + match[0].length
    const end = eventHandlerPropEnd(line, valueStart)
    if (end === null) continue
    result += line.slice(cursor, start)
    cursor = end
  }
  return cursor === 0 ? line : `${result}${line.slice(cursor)}`
}

function hasUnsafeUrlScheme(value: string): boolean {
  const normalized = value
    .trim()
    .replace(/[\u0000-\u0020]/g, '')
    .replace(/&(?:#x0*3a|#0*58|colon);/gi, ':')
  return /^(?:javascript|data|vbscript):/i.test(normalized)
}

function hasUnsafePortableUrlProp(value: string): boolean {
  const quotedProps = new RegExp(`\\b(?:${PORTABLE_URL_PROPS})\\s*=\\s*(['"])([^'"\\r\\n]*)\\1`, 'gi')
  for (const match of value.matchAll(quotedProps)) {
    if (hasUnsafeUrlScheme(match[2])) return true
  }
  const expressionProps = new RegExp(`\\b(?:${PORTABLE_URL_PROPS})\\s*=\\s*\\{\\s*("(?:\\\\.|[^"\\\\])*")\\s*\\}`, 'gi')
  for (const match of value.matchAll(expressionProps)) {
    try {
      if (hasUnsafeUrlScheme(JSON.parse(match[1]))) return true
    } catch {
      return true
    }
  }
  return false
}

function portableHtmlToMarkdown(value: string): string {
  return value
    .replace(/<span\b[^>]*>|<\/span>/gi, '')
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_original, attributes: string, label: string) => {
      const href = attributes.match(/\bhref\s*=\s*(['"])(.*?)\1/i)?.[2]
      const plainLabel = label.replace(/<[^>]+>/g, '').trim()
      if (!href || hasUnsafeUrlScheme(href)) return plainLabel
      return `[${plainLabel.replace(/]/g, '\\]')}](${href})`
    })
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_original, level: string, content: string) => {
      return `\n${'#'.repeat(Number(level))} ${content.trim()}\n`
    })
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_original, content: string) => `\n${content.trim()}\n`)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?(?:article|div|main|section)\b[^>]*>/gi, '')
}

function transformMarkdownProse(body: string, transform: (value: string) => string): string {
  const output: Array<string> = []
  let prose: Array<string> = []
  let fenceCharacter = ''
  let fenceLength = 0
  const flushProse = () => {
    if (prose.length === 0) return
    output.push(transform(prose.join('\n')))
    prose = []
  }
  for (const line of body.split('\n')) {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    if (fence && !fenceCharacter) {
      flushProse()
      fenceCharacter = fence[1][0]
      fenceLength = fence[1].length
      output.push(line)
      continue
    }
    if (fenceCharacter) {
      output.push(line)
      if (fence && fence[1][0] === fenceCharacter && fence[1].length >= fenceLength
        && fence[2].trim() === '') {
        fenceCharacter = ''
        fenceLength = 0
      }
      continue
    }
    prose.push(line)
  }
  flushProse()
  return output.join('\n')
}

function sanitizeRemoteMarkdown(body: string): string | null {
  let fenceCharacter = ''
  let fenceLength = 0
  const portableBody = transformMarkdownProse(body, portableHtmlToMarkdown)
  const sanitized = portableBody.split('\n').map((line) => {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    if (fence && !fenceCharacter) {
      fenceCharacter = fence[1][0]
      fenceLength = fence[1].length
      return line
    }
    if (fence && fence[1][0] === fenceCharacter && fence[1].length >= fenceLength
      && fence[2].trim() === '') {
      fenceCharacter = ''
      fenceLength = 0
      return line
    }
    if (fenceCharacter) return line
    return portableHtmlToMarkdown(stripEventHandlerProps(line
      .replace(/!\[([^\]]*)\]\(\s*([^)]+)\)/g, (original, alternative: string, destination: string) => {
        return hasUnsafeUrlScheme(destination.replace(/^<|>$/g, '')) ? alternative : original
      })
      .replace(/<img\s+([^>]*?)\/?\s*>/gi, (original, attributes: string) => {
        const source = attributes.match(/\bsrc\s*=\s*(['"])(.*?)\1/i)?.[2]
        const alternative = attributes.match(/\balt\s*=\s*(['"])(.*?)\1/i)?.[2] ?? ''
        if (!source || hasUnsafeUrlScheme(source)) return ''
        return `![${alternative.replace(/]/g, '\\]')}](${source})`
      })))
  }).join('\n')
  const executable = withoutFencedCode(sanitized)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<(?:https?:\/\/|mailto:)[^>]+>/gi, '')
    .replace(/(`+)[\s\S]*?\1/g, '')
  if (/^\s*(?:import|export)\s/m.test(executable)) return null
  // A public Markdown endpoint is still attacker-controlled MDX. Preserve
  // known documentation primitives and JSON-literal props, but never compile
  // executable expressions, raw HTML, event handlers, or local components.
  let hasUnsafeExpression = false
  const withoutStaticProps = executable.replace(/=\{([^{}\n]*)\}/g, (original, value: string) => {
    try {
      JSON.parse(value)
      return '=""'
    } catch {
      hasUnsafeExpression = true
      return original
    }
  }).replace(/\\[{}]/g, '')
  if (hasUnsafeExpression || /[{}]/.test(withoutStaticProps)
    || /\bon[A-Z][A-Za-z]*\s*=/g.test(withoutStaticProps)
    || hasUnsafePortableUrlProp(executable)) return null
  for (const match of withoutStaticProps.matchAll(/<\/?([A-Za-z][A-Za-z0-9.]*)(?:\s|>|\/)/g)) {
    const component = match[1].split('.', 1)[0]
    if (!PORTABLE_MDX_COMPONENTS.has(component)) return null
  }
  return sanitized
}

function migratedHref(
  href: string,
  currentUrl: URL,
  source: URL,
  scopePath: string,
  importedIds: Set<string>,
  sourceHomePageId?: string,
): string {
  if (/^(?:javascript|data|vbscript):/i.test(href)) return '#'
  if (href.startsWith('#') || /^(?:mailto|tel):/i.test(href)) return href
  try {
    const target = new URL(href, currentUrl)
    if (target.origin !== source.origin) return href
    if (scopePath === '/' && candidateIdentity(target) === candidateIdentity(source)) {
      return `/${target.search}${target.hash}`
    }
    let path = target.pathname
    if (scopePath !== '/' && (path === scopePath || path.startsWith(`${scopePath}/`))) {
      path = path.slice(scopePath.length)
    }
    const id = pageIdFromReference(path.replace(/^\/+/, '') || 'introduction')
    const localizedId = id ? canonicalLocalizedPageId(id) : id
    const destinationId = localizedId === sourceHomePageId ? 'introduction' : localizedId
    let importedDestinationId = destinationId && importedIds.has(destinationId)
      ? destinationId
      : undefined
    if (destinationId && !importedDestinationId) {
      importedDestinationId = [`${destinationId}/overview`, `${destinationId}/introduction`]
        .find((candidate) => importedIds.has(candidate))
        ?? [...importedIds].find((candidate) => candidate.startsWith(`${destinationId}/`))
    }
    if (importedDestinationId) {
      const destination = importedDestinationId === 'introduction' ? '/' : `/${importedDestinationId}`
      return `${destination}${target.search}${target.hash}`
    }
    // Same-origin marketing and intentionally missing example links remain
    // valid external URLs instead of becoming broken links in the new site.
    return target.toString()
  } catch {
    return href
  }
}

function rewriteInternalLinks(
  body: string,
  currentUrl: URL,
  source: URL,
  scopePath: string,
  importedIds: Set<string>,
  sourceHomePageId?: string,
): string {
  const markdown = body.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(\s+['"][^'"]*['"])?\)/g, (
    original,
    label: string,
    href: string,
    title = '',
  ) => {
    const destination = migratedHref(href, currentUrl, source, scopePath, importedIds, sourceHomePageId)
    return destination === href ? original : `[${label}](${destination}${title})`
  })
  return markdown.replace(/\bhref=(['"])([^'"]+)\1/g, (_original, quote: string, href: string) => {
    const destination = migratedHref(href, currentUrl, source, scopePath, importedIds, sourceHomePageId)
    return `href=${quote}${destination}${quote}`
  })
}

function remoteMarkdownMetadata(body: string): {
  content: string
  title?: string
  description?: string
} {
  if (!/^---\r?\n/.test(body)) return { content: body }
  const end = body.slice(4, 65_540).search(/\r?\n---(?:\r?\n|$)/)
  if (end < 0) return { content: body }
  const frontmatter = body.slice(4, end + 4)
  const contentStart = end + 4 + body.slice(end + 4).match(/^\r?\n---(?:\r?\n|$)/)![0].length
  function scalar(key: string): string | undefined {
    const value = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim()
    if (!value) return undefined
    if (/^['"].*['"]$/.test(value)) {
      try {
        const parsed = JSON.parse(value.replace(/^'/, '"').replace(/'$/, '"'))
        return typeof parsed === 'string' ? parsed : undefined
      } catch {
        return value.slice(1, -1)
      }
    }
    return value.slice(0, 500)
  }
  return {
    content: body.slice(contentStart),
    title: scalar('title'),
    description: scalar('description'),
  }
}

function stripMintlifyDocumentationIndex(body: string): string {
  const lines = body.split(/\r?\n/)
  if (!/^>\s*##\s+Documentation Index\s*$/i.test(lines[0] ?? '')
    || !/^>.*\/llms(?:-full)?\.txt/i.test(lines[1] ?? '')
    || !/^>.*discover all available pages/i.test(lines[2] ?? '')) return body
  let index = 3
  while (index < lines.length && /^>/.test(lines[index])) index += 1
  while (index < lines.length && lines[index].trim() === '') index += 1
  return lines.slice(index).join('\n')
}

function extractEmbeddedOpenApi(content: string): {
  content: string
  openapi?: string
  fragment?: EmbeddedOpenApiFragment
} {
  const fencePattern = /^\s{0,3}(`{3,}|~{3,})(?:yaml|yml|json)\s+(\S+\.(?:yaml|yml|json))\s+(delete|get|head|options|patch|post|put|trace)\s+(\/\S+)\s*\r?\n([\s\S]*?)^\s{0,3}\1\s*$/im
  const match = fencePattern.exec(content)
  if (!match) return { content }
  try {
    const parsed = parseYaml(match[5], { maxAliasCount: 50 })
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { content }
    const document = parsed as Record<string, unknown>
    if (typeof document.openapi !== 'string' && typeof document.swagger !== 'string') return { content }
    const method = match[3].toUpperCase()
    const path = match[4]
    const paths = document.paths
    if (!paths || typeof paths !== 'object' || Array.isArray(paths)) return { content }
    const pathItem = (paths as Record<string, unknown>)[path]
    if (!pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)
      || !(match[3].toLowerCase() in pathItem)) return { content }
    const before = content.slice(0, match.index).replace(/(?:^|\n)##\s+OpenAPI\s*\n\s*$/i, '\n')
    const after = content.slice(match.index + match[0].length)
    return {
      content: `${before}${after}`.trim(),
      openapi: `${method} ${path}`,
      fragment: {
        method,
        path,
        document,
      },
    }
  } catch {
    return { content }
  }
}

function markdownPage(document: MigrationFetchResponse, id: string): {
  page: MigrationPage | null
  openApiFragment?: EmbeddedOpenApiFragment
} {
  const parsed = remoteMarkdownMetadata(document.body)
  let content = stripMintlifyDocumentationIndex(parsed.content).trimStart()
  const titleMatch = content.match(/^#\s+(.+)\r?\n/)
  const title = parsed.title ?? titleMatch?.[1] ?? id.split('/').at(-1) ?? 'Introduction'
  if (titleMatch) content = content.slice(titleMatch[0].length).trimStart()
  let description = parsed.description
  if (!description) {
    const quoteMatch = content.match(/^(>[^\r\n]*(?:\r?\n>[^\r\n]*)*)\r?\n/)
    if (quoteMatch) {
      description = plainDescription(quoteMatch[1].replace(/^>\s?/gm, ''))
      content = content.slice(quoteMatch[0].length).trimStart()
    }
  }
  // Re-emit only scalar metadata we parsed ourselves. `gray-matter` remains in
  // the shared page parser for trusted repository sources, but never receives
  // attacker-controlled YAML aliases from a public URL.
  const embeddedOpenApi = extractEmbeddedOpenApi(content)
  const raw = [
    '---',
    `title: ${JSON.stringify(title)}`,
    ...(description ? [`description: ${JSON.stringify(description)}`] : []),
    ...(embeddedOpenApi.openapi ? [`openapi: ${JSON.stringify(embeddedOpenApi.openapi)}`] : []),
    '---',
    '',
    embeddedOpenApi.content,
  ].join('\n')
  return {
    page: parseMarkdownPage({ id, raw, source: document.finalUrl.toString() }),
    openApiFragment: embeddedOpenApi.fragment,
  }
}

function mergeRecord(target: Record<string, unknown>, source: unknown): void {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return
  for (const [key, value] of Object.entries(source)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      target[key] = value
      continue
    }
    const current = target[key]
    if (current && value && typeof current === 'object' && typeof value === 'object'
      && !Array.isArray(current) && !Array.isArray(value)) {
      mergeRecord(current as Record<string, unknown>, value)
    }
  }
}

function mergeEmbeddedOpenApi(fragments: Array<EmbeddedOpenApiFragment>): Uint8Array | null {
  const first = fragments[0]
  if (!first) return null
  const combined: Record<string, unknown> = {
    ...first.document,
    paths: {},
    components: {},
  }
  const combinedPaths = combined.paths as Record<string, unknown>
  const combinedComponents = combined.components as Record<string, unknown>
  const tags = new Map<string, unknown>()
  for (const fragment of fragments) {
    const sourcePaths = fragment.document.paths as Record<string, unknown>
    const sourcePathItem = sourcePaths?.[fragment.path]
    if (!sourcePathItem || typeof sourcePathItem !== 'object' || Array.isArray(sourcePathItem)) continue
    const sourceOperation = (sourcePathItem as Record<string, unknown>)[fragment.method.toLowerCase()]
    if (!sourceOperation || typeof sourceOperation !== 'object' || Array.isArray(sourceOperation)) continue
    const operation = { ...(sourceOperation as Record<string, unknown>) }
    if (!operation.servers && Array.isArray(fragment.document.servers)) operation.servers = fragment.document.servers
    if (!operation.security && Array.isArray(fragment.document.security)) operation.security = fragment.document.security
    const existingPath = combinedPaths[fragment.path]
    const pathItem = existingPath && typeof existingPath === 'object' && !Array.isArray(existingPath)
      ? existingPath as Record<string, unknown>
      : {}
    for (const sharedKey of ['parameters', 'servers', 'summary', 'description']) {
      const sharedValue = (sourcePathItem as Record<string, unknown>)[sharedKey]
      if (sharedValue !== undefined && pathItem[sharedKey] === undefined) pathItem[sharedKey] = sharedValue
    }
    pathItem[fragment.method.toLowerCase()] = operation
    combinedPaths[fragment.path] = pathItem
    mergeRecord(combinedComponents, fragment.document.components)
    for (const tag of Array.isArray(fragment.document.tags) ? fragment.document.tags : []) {
      if (!tag || typeof tag !== 'object' || Array.isArray(tag)) continue
      const name = (tag as Record<string, unknown>).name
      if (typeof name === 'string' && !tags.has(name)) tags.set(name, tag)
    }
  }
  if (Object.keys(combinedPaths).length === 0) return null
  if (Object.keys(combinedComponents).length === 0) delete combined.components
  if (tags.size > 0) combined.tags = [...tags.values()]
  return new TextEncoder().encode(stringifyYaml(combined))
}

function htmlPage(
  document: MigrationFetchResponse,
  id: string,
): { page: MigrationPage | null; links: Array<string> } {
  const $ = load(document.body)
  const links = $('nav a[href], main a[href], article a[href], [role="main"] a[href]')
    .map((_index, element) => $(element).attr('href') ?? '')
    .get()
    .filter(Boolean)
  const title = $('main h1, article h1, h1').first().text().trim()
    || $('meta[property="og:title"]').attr('content')?.trim()
    || $('title').text().split('|')[0].trim()
  const description = $('meta[name="description"]').attr('content')?.trim()
    || $('meta[property="og:description"]').attr('content')?.trim()
  const content = $('main article, article, main, [role="main"]').first()
  const root = content.length ? content : $('body')
  root.find('script,style,noscript,nav,header,footer,aside,form,button,svg,iframe,object,embed,link,meta').remove()
  root.find('a[href]').each((_index, element) => {
    const href = $(element).attr('href')
    if (!href) return
    try {
      const resolved = new URL(href, document.finalUrl)
      if (['http:', 'https:', 'mailto:', 'tel:'].includes(resolved.protocol)) {
        $(element).attr('href', resolved.toString())
      } else {
        $(element).removeAttr('href')
      }
    } catch {
      $(element).removeAttr('href')
    }
  })
  root.find('img[src]').each((_index, element) => {
    const src = $(element).attr('src')
    if (!src) return
    try {
      const resolved = new URL(src, document.finalUrl)
      if (['http:', 'https:'].includes(resolved.protocol)) {
        $(element).attr('src', resolved.toString())
      } else {
        $(element).removeAttr('src')
      }
    } catch {
      $(element).removeAttr('src')
    }
  })
  const turndown = new TurndownService({ codeBlockStyle: 'fenced', emDelimiter: '_', headingStyle: 'atx' })
  turndown.remove(['script', 'style', 'noscript'])
  turndown.addRule('migration-safe-fenced-code', {
    filter: (node) => node.nodeName === 'PRE',
    replacement: (_content, node) => {
      const element = node as HTMLElement
      const code = element.textContent?.replace(/\n$/, '') ?? ''
      const language = element.querySelector('code')?.className.match(/(?:language-|lang-)([A-Za-z0-9_+-]+)/)?.[1] ?? ''
      const longestFence = Math.max(0, ...[...code.matchAll(/`+/g)].map((match) => match[0].length))
      const fence = '`'.repeat(Math.max(3, longestFence + 1))
      return `\n\n${fence}${language}\n${code}\n${fence}\n\n`
    },
  })
  const escape = turndown.escape.bind(turndown)
  turndown.escape = (text: string) => escape(text).replace(/[<{]/g, (match) => `\\${match}`)
  const body = turndown.turndown(root.html() ?? '').trim()
  if (!title || body.length < 40) return { page: null, links }
  return {
    page: {
      id,
      navigationId: id,
      title,
      description: description || plainDescription(body) || `Documentation imported from ${document.finalUrl.hostname}.`,
      keywords: [],
      body,
      source: document.finalUrl.toString(),
    },
    links,
  }
}

function htmlNavigationLinks(document: MigrationFetchResponse): Array<string> {
  const $ = load(document.body)
  return $('.nav-tabs a[href], nav a[href], aside a[href], [role="navigation"] a[href]')
    .map((_index, element) => $(element).attr('href') ?? '')
    .get()
    .filter(Boolean)
}

interface SourceNavigationTab {
  section: string
  label: string
  pageId: string
}

function htmlTopLevelNavigation(
  document: MigrationFetchResponse,
  source: URL,
  scopePath: string,
): Array<SourceNavigationTab> {
  const $ = load(document.body)
  interface NavigationCandidate {
    entries: Array<SourceNavigationTab>
    anchorCount: number
  }
  const collectCandidates = (selector: string): Array<NavigationCandidate> => {
    const candidates: Array<NavigationCandidate> = []
    $(selector).each((_containerIndex, container) => {
      const entries: Array<SourceNavigationTab> = []
      const seenSections = new Set<string>()
      let anchorCount = 0
      $(container).find('a[href]').each((_index, element) => {
        const label = $(element).text().replace(/\s+/g, ' ').trim()
        const href = $(element).attr('href')
        if (!label || !href) return
        try {
          const target = new URL(href, document.finalUrl)
          if (!isInScope(target, source, scopePath)) return
          anchorCount += 1
          const targetId = canonicalLocalizedPageId(pageIdForUrl(target, scopePath) ?? '')
          const pageId = targetId
          const section = targetId.split('/', 1)[0] || 'introduction'
          if (!pageId || seenSections.has(section)) return
          seenSections.add(section)
          entries.push({ section, label, pageId })
        } catch {
          // Ignore malformed navigation targets; discovery applies the same rule.
        }
      })
      if (entries.length > 1) {
        candidates.push({ entries, anchorCount })
      }
    })
    return candidates
  }
  // Mintlify marks its product-tab strip consistently. Prefer that explicit
  // platform signal; generic nav elements usually describe only the sidebar.
  const tabCandidates = collectCandidates('.nav-tabs')
  const candidates = tabCandidates.length > 0
    ? tabCandidates
    : collectCandidates('nav, [role="navigation"]')
  return candidates.sort((left, right) => {
    const densityDifference = (right.entries.length / right.anchorCount)
      - (left.entries.length / left.anchorCount)
    return densityDifference || right.entries.length - left.entries.length
  })[0]?.entries ?? []
}

function markdownLinks(body: string): Array<string> {
  return [...body.matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g)]
    .map((match) => match[1])
}

function sitemapLinks(body: string): Array<string> {
  const $ = load(body, { xmlMode: true })
  return $('url > loc, sitemap > loc').map((_index, element) => $(element).text().trim()).get().filter(Boolean)
}

function robotsSitemaps(body: string): Array<string> {
  return body.split('\n')
    .map((line) => line.match(/^\s*Sitemap:\s*(\S+)/i)?.[1])
    .filter((value): value is string => Boolean(value))
}

function headerLinks(document: MigrationFetchResponse): Array<string> {
  const links: Array<string> = []
  const llms = document.headers?.['x-llms-txt']
  if (llms) links.push(llms)
  const linkHeader = document.headers?.link ?? ''
  for (const match of linkHeader.matchAll(/<([^>]+)>\s*;[^,]*(?:rel=["']?(?:alternate|llms-txt)["']?|type=["']text\/(?:markdown|plain)["'])/gi)) {
    links.push(match[1])
  }
  return links
}

async function safeFetch(
  fetcher: MigrationFetcher,
  url: URL,
  accept: string,
): Promise<MigrationFetchResponse | null> {
  try {
    return await fetcher(url, { accept })
  } catch {
    return null
  }
}

/** Crawl one public docs origin into a canonical, caller-independent bundle. */
export async function migrateUrl(options: UrlMigrationOptions): Promise<MigrationBundle> {
  const source = validateMigrationUrl(options.sourceUrl)
  const fetcher = options.fetcher ?? defaultMigrationFetcher
  const maxPages = Math.max(1, Math.min(options.maxPages ?? DEFAULT_MAX_PAGES, 1_000))
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 5, 10))
  const maxTotalBytes = Math.max(1_000_000, Math.min(options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES, 500_000_000))
  const submittedScopePath = docsScopePath(source)
  const initial = await fetcher(source, { accept: 'text/markdown,text/html,application/xhtml+xml;q=0.9' })
  if (!isInScope(initial.finalUrl, source, submittedScopePath)) {
    throw new Error('The documentation URL redirected outside the submitted docs origin or path.')
  }
  const htmlProbe = /html/i.test(initial.contentType)
    ? initial
    : await safeFetch(fetcher, source, 'text/html,application/xhtml+xml')
  // Content negotiation must not let an HTML-only redirect escape the path
  // boundary already validated for the submitted documentation response.
  const scopedHtmlProbe = htmlProbe && isInScope(htmlProbe.finalUrl, source, submittedScopePath)
    ? htmlProbe
    : null
  const platform = detectUrlPlatform(scopedHtmlProbe ?? initial)
  // A Mintlify site may own an entire docs origin or a path below a marketing
  // site. Its llms/sitemap location is the authoritative crawl boundary.
  const scopePath = platform === 'mintlify'
    ? machineIndexScopePath(source, [initial, scopedHtmlProbe]) ?? submittedScopePath
    : submittedScopePath
  const sourceTopLevelNavigation = platform === 'mintlify' && scopedHtmlProbe && /html/i.test(scopedHtmlProbe.contentType)
    ? htmlTopLevelNavigation(scopedHtmlProbe, source, scopePath)
    : undefined
  // The submitted URL can be any page. Mintlify's first authored product tab,
  // rather than the submitted page, defines which source page becomes `/`.
  // Older single-section themes do not expose a tab strip, so they retain the
  // legacy dedicated-origin fallback when no authored home can be recovered.
  const sourceHomePageId = sourceTopLevelNavigation?.[0]?.pageId
    ?? (platform === 'mintlify' && scopePath === '/'
      ? canonicalLocalizedPageId(pageIdForUrl(source, scopePath) ?? '') || undefined
      : undefined)
  const cache = new Map([[source.toString(), initial]])
  const queue: Array<URL> = [source]
  const queued = new Set([candidateIdentity(source)])
  const warnings: Array<MigrationWarning> = []
  const fetchedSitemaps = new Set<string>()

  function enqueue(value: string, base: URL): void {
    if (queued.size >= MAX_DISCOVERED_URLS) return
    const url = normalizeCandidate(value, base, source, scopePath)
    if (!url || queued.has(candidateIdentity(url))) return
    queued.add(candidateIdentity(url))
    queue.push(url)
  }

  // Mintlify renders the authored navigation into the HTML shell. Seed the
  // queue from that order before machine indexes add completeness fallbacks.
  if (scopedHtmlProbe && /html/i.test(scopedHtmlProbe.contentType)) {
    for (const link of htmlNavigationLinks(scopedHtmlProbe)) enqueue(link, scopedHtmlProbe.finalUrl)
  }

  async function discoverDocumentLinks(document: MigrationFetchResponse, depth = 0): Promise<void> {
    const links = sitemapLinks(document.body)
    for (const link of links) {
      let url: URL
      try {
        url = new URL(link, document.finalUrl)
      } catch {
        continue
      }
      if (depth < 2 && /\.xml(?:$|\?)/i.test(url.pathname)) {
        if (url.origin !== source.origin || fetchedSitemaps.size >= MAX_SITEMAP_DOCUMENTS
          || fetchedSitemaps.has(url.toString())) continue
        fetchedSitemaps.add(url.toString())
        const nested = await safeFetch(fetcher, url, 'application/xml,text/xml')
        if (nested && nested.finalUrl.origin === source.origin) await discoverDocumentLinks(nested, depth + 1)
      } else {
        enqueue(link, document.finalUrl)
      }
    }
  }

  for (const link of headerLinks(initial)) {
    let url: URL
    try {
      url = new URL(link, initial.finalUrl)
    } catch {
      continue
    }
    if (url.origin !== source.origin) continue
    const document = await safeFetch(fetcher, url, 'text/plain,text/markdown')
    if (!document || document.finalUrl.origin !== source.origin) continue
    for (const candidate of markdownLinks(document.body)) enqueue(candidate, document.finalUrl)
  }

  const pathRoot = scopePath === '/' ? source.origin : `${source.origin}${scopePath}`
  const discoveryUrls = [
    new URL('/llms.txt', source.origin),
    new URL(`${pathRoot.replace(source.origin, '')}/llms.txt`, source.origin),
    new URL('/robots.txt', source.origin),
    new URL('/sitemap.xml', source.origin),
    new URL(`${pathRoot.replace(source.origin, '')}/sitemap.xml`, source.origin),
  ]
  const uniqueDiscovery = [...new Map(discoveryUrls.map((url) => [url.toString(), url])).values()]
  for (const url of uniqueDiscovery) {
    const document = await safeFetch(fetcher, url, 'text/plain,application/xml,text/xml;q=0.9')
    if (!document || document.finalUrl.origin !== source.origin) continue
    const isRobots = url.pathname.endsWith('robots.txt')
    const isSitemap = url.pathname.endsWith('sitemap.xml') || document.contentType.includes('xml')
    if (isRobots) {
      for (const link of robotsSitemaps(document.body)) {
        let sitemapUrl: URL
        try {
          sitemapUrl = new URL(link, document.finalUrl)
        } catch {
          continue
        }
        if (sitemapUrl.origin !== source.origin || fetchedSitemaps.size >= MAX_SITEMAP_DOCUMENTS
          || fetchedSitemaps.has(sitemapUrl.toString())) continue
        fetchedSitemaps.add(sitemapUrl.toString())
        const sitemap = await safeFetch(fetcher, sitemapUrl, 'application/xml,text/xml')
        if (sitemap && sitemap.finalUrl.origin === source.origin) await discoverDocumentLinks(sitemap)
      }
    } else if (isSitemap) {
      await discoverDocumentLinks(document)
    } else {
      for (const link of markdownLinks(document.body)) enqueue(link, document.finalUrl)
    }
  }

  const pages: Array<MigrationPage> = []
  const openApiFragments: Array<EmbeddedOpenApiFragment> = []
  const seenIds = new Set<string>()
  const seenSources = new Set<string>()
  const visited = new Set<string>()
  let importedBytes = 0
  let isByteBudgetExhausted = false
  while (queue.length > 0 && pages.length < maxPages && !isByteBudgetExhausted) {
    const batch: Array<URL> = []
    while (queue.length > 0 && batch.length < Math.min(concurrency, maxPages - pages.length)) {
      const candidate = queue.shift()
      if (!candidate || visited.has(candidate.toString())) continue
      visited.add(candidate.toString())
      batch.push(candidate)
    }
    if (batch.length === 0) continue
    const results = await Promise.all(batch.map(async (candidate) => {
      let document = cache.get(candidate.toString())
        ?? await safeFetch(fetcher, candidate, 'text/markdown,text/html,application/xhtml+xml;q=0.9')
      if (!document) {
        return { candidate, page: null, links: [] as Array<string>, failure: true }
      }
      if (!isInScope(document.finalUrl, source, scopePath)) {
        return { candidate, page: null, links: [] as Array<string>, failure: false }
      }
      const isMarkdown = /(?:markdown|text\/plain)/i.test(document.contentType)
        || /\.mdx?$/i.test(document.finalUrl.pathname)
      if (!isMarkdown && !/\.mdx?$/i.test(candidate.pathname)) {
        const markdownUrl = new URL(candidate)
        markdownUrl.pathname = `${markdownUrl.pathname.replace(/\/$/, '')}.md`
        const markdownDocument = await safeFetch(fetcher, markdownUrl, 'text/markdown,text/plain')
        if (markdownDocument && isInScope(markdownDocument.finalUrl, source, scopePath)
          && /(?:markdown|text\/plain)/i.test(markdownDocument.contentType)) {
          document = markdownDocument
        }
      }
      const isResolvedMarkdown = /(?:markdown|text\/plain)/i.test(document.contentType)
        || /\.mdx?$/i.test(document.finalUrl.pathname)
      const sanitizedMarkdown = isResolvedMarkdown ? sanitizeRemoteMarkdown(document.body) : null
      if (isResolvedMarkdown && sanitizedMarkdown === null) {
        const htmlUrl = new URL(candidate)
        htmlUrl.pathname = htmlUrl.pathname.replace(/\.mdx?$/i, '') || '/'
        const htmlDocument = await safeFetch(fetcher, htmlUrl, 'text/html,application/xhtml+xml')
        if (htmlDocument && isInScope(htmlDocument.finalUrl, source, scopePath)
          && /html/i.test(htmlDocument.contentType)) {
          document = htmlDocument
        } else {
          // Never recover by compiling the rejected MDX. A source that does
          // not expose a safe rendered representation is skipped instead.
          return { candidate, page: null, links: [] as Array<string>, failure: false }
        }
      } else if (sanitizedMarkdown !== null) {
        document = { ...document, body: sanitizedMarkdown }
      }
      const responseBytes = Buffer.byteLength(document.body, 'utf8')
      if (importedBytes + responseBytes > maxTotalBytes) {
        isByteBudgetExhausted = true
        return { candidate, page: null, links: [] as Array<string>, failure: false, budgetExceeded: true }
      }
      importedBytes += responseBytes
      const discoveredId = pageIdForUrl(document.finalUrl, scopePath)
        ?? pageIdForUrl(candidate, scopePath)
      const id = discoveredId && canonicalLocalizedPageId(discoveredId) === sourceHomePageId
        ? 'introduction'
        : discoveredId
      if (!id) return { candidate, page: null, links: [] as Array<string>, failure: false }
      if (/(?:markdown|text\/plain)/i.test(document.contentType) || /\.mdx?$/i.test(document.finalUrl.pathname)) {
        const markdown = markdownPage(document, id)
        return {
          candidate,
          page: markdown.page,
          openApiFragment: markdown.openApiFragment,
          links: markdownLinks(document.body),
          base: document.finalUrl,
          failure: false,
        }
      }
      const extracted = htmlPage(document, id)
      return { candidate, page: extracted.page, links: extracted.links, base: document.finalUrl, failure: false }
    }))
    for (const result of results) {
      if (result.failure) {
        warnings.push({ code: 'fetch-failed', message: 'A discovered documentation page could not be fetched.', source: result.candidate.toString() })
        continue
      }
      if (result.budgetExceeded) continue
      if (result.page) result.page.id = canonicalLocalizedPageId(result.page.id)
      const sourceIdentity = result.page
        ? candidateIdentity(new URL(result.page.source))
        : null
      if (result.page && sourceIdentity && !seenSources.has(sourceIdentity)
        && !seenIds.has(result.page.id) && pages.length < maxPages) {
        pages.push(result.page)
        if ('openApiFragment' in result && result.openApiFragment) {
          openApiFragments.push(result.openApiFragment)
        }
        seenIds.add(result.page.id)
        seenSources.add(sourceIdentity)
      }
      for (const link of result.links) enqueue(link, result.base ?? result.candidate)
    }
  }

  if (pages.length === 0) throw new Error('No readable documentation pages were found at that URL.')
  for (const page of pages) {
    const [locale, ...navigationSegments] = page.id.split('/')
    if (LOCALE_CODES.has(locale)) {
      if (navigationSegments.length === 0) page.id = `${locale}/introduction`
      page.locale = locale
      page.navigationId = navigationSegments.join('/') || 'introduction'
    }
  }
  const importedIds = new Set(pages.map((page) => page.id))
  for (const page of pages) {
    page.body = rewriteInternalLinks(
      page.body,
      new URL(page.source),
      source,
      scopePath,
      importedIds,
      sourceHomePageId,
    )
  }
  if (isByteBudgetExhausted) {
    warnings.push({ code: 'limit-reached', message: `Import stopped after reaching the ${Math.round(maxTotalBytes / 1_000_000)} MB content budget.` })
  } else if (queue.length > 0 || queued.size >= MAX_DISCOVERED_URLS) {
    warnings.push({ code: 'limit-reached', message: `Import stopped after ${pages.length} pages; narrow the URL or raise the caller limit to import more.` })
  }
  const topLevelNavigation = sourceTopLevelNavigation?.map((entry) => ({
    ...entry,
    pageId: entry.pageId === sourceHomePageId ? 'introduction' : entry.pageId,
  }))
  const docsConfig = buildNavigationFromPages(pages, {
    topLevelTabs: platform === 'mintlify',
    topLevelNavigation,
  })
  const openApiAsset = mergeEmbeddedOpenApi(openApiFragments)
  if (openApiAsset) {
    const operationPageIds = new Set(pages.filter((page) => page.openapi).map((page) => page.navigationId))
    const apiTab = docsConfig.tabs.find((tab) => tab.groups?.some((group) => {
      const containsOperation = (pages: typeof group.pages): boolean => pages.some((page) => {
        return typeof page === 'string' ? operationPageIds.has(page) : containsOperation(page.pages)
      })
      return containsOperation(group.pages)
    })) ?? docsConfig.tabs[0]
    if (apiTab) {
      // Migrated operation pages preserve the source URLs and sidebar order.
      // The spec is still configured for operation rendering, but its derived
      // `/api/*` navigation would duplicate every imported endpoint.
      apiTab.api = { source: '/openapi.yaml', navigation: false }
    }
  }
  const locales = [...new Set(pages.map((page) => page.locale).filter((value): value is string => Boolean(value)))]
  if (locales.length > 0) {
    docsConfig.i18n = {
      defaultLocale: 'en',
      locales: [
        { code: 'en', label: 'English' },
        ...locales.filter((locale) => locale !== 'en').map((locale) => ({ code: locale, label: locale.toUpperCase() })),
      ],
    }
  }
  return {
    sourceUrl: source.toString(),
    sourceKind: 'url',
    platform,
    pages,
    assets: openApiAsset ? [{ path: 'openapi.yaml', content: openApiAsset }] : [],
    docsConfig,
    warnings,
    stats: {
      discovered: visited.size,
      imported: pages.length,
      skipped: Math.max(0, visited.size - pages.length),
    },
  }
}
