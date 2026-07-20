/**
 * Public URL adapter for the shared migration engine. Discovery prefers
 * machine-readable Markdown and sitemaps, remains scoped to the submitted docs
 * path, then falls back to bounded navigation crawling and HTML extraction.
 */

import { load } from 'cheerio'
import TurndownService from 'turndown'

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
  'th', 'tr', 'uk', 'vi', 'zh',
])

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
    if (/\.(?:avif|bmp|gif|ico|jpe?g|mp[34]|pdf|png|svg|webm|webp|zip)$/i.test(url.pathname)) return null
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

function detectUrlPlatform(document: MigrationFetchResponse): MigrationPlatform {
  const value = `${document.body.slice(0, 200_000)} ${document.headers?.['x-powered-by'] ?? ''}`.toLowerCase()
  if (value.includes('mintlify') || value.includes('__mintlify')) return 'mintlify'
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

function sanitizeRemoteMarkdown(body: string): string | null {
  let fenceCharacter = ''
  let fenceLength = 0
  const sanitized = body.split('\n').map((line) => {
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
    return line
      .replace(/<\/?div\b[^>]*>/gi, '')
      .replace(/<img\s+([^>]*?)\/?\s*>/gi, (original, attributes: string) => {
        const source = attributes.match(/\bsrc\s*=\s*(['"])(.*?)\1/i)?.[2]
        const alternative = attributes.match(/\balt\s*=\s*(['"])(.*?)\1/i)?.[2] ?? ''
        if (!source || /^(?:javascript|data):/i.test(source)) return ''
        return `![${alternative.replace(/]/g, '\\]')}](${source})`
      })
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
    || /\b(?:href|src)\s*=\s*(['"])\s*(?:javascript|data):/gi.test(withoutStaticProps)) return null
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
): string {
  if (/^(?:javascript|data|vbscript):/i.test(href)) return '#'
  if (href.startsWith('#') || /^(?:mailto|tel):/i.test(href)) return href
  try {
    const target = new URL(href, currentUrl)
    if (target.origin !== source.origin) return href
    let path = target.pathname
    if (scopePath !== '/' && (path === scopePath || path.startsWith(`${scopePath}/`))) {
      path = path.slice(scopePath.length)
    }
    const id = pageIdFromReference(path.replace(/^\/+/, '') || 'introduction')
    const localizedId = id && LOCALE_CODES.has(id) ? `${id}/introduction` : id
    if (localizedId && importedIds.has(localizedId)) {
      const destination = localizedId === 'introduction' ? '/' : `/${localizedId.replace(/\/introduction$/, '')}`
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
): string {
  const markdown = body.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(\s+['"][^'"]*['"])?\)/g, (
    original,
    label: string,
    href: string,
    title = '',
  ) => {
    const destination = migratedHref(href, currentUrl, source, scopePath, importedIds)
    return destination === href ? original : `[${label}](${destination}${title})`
  })
  return markdown.replace(/\bhref=(['"])([^'"]+)\1/g, (_original, quote: string, href: string) => {
    const destination = migratedHref(href, currentUrl, source, scopePath, importedIds)
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

function markdownPage(document: MigrationFetchResponse, id: string): MigrationPage | null {
  const parsed = remoteMarkdownMetadata(document.body)
  const titleMatch = parsed.content.match(/^#\s+(.+)$/m)
  const title = parsed.title ?? titleMatch?.[1] ?? id.split('/').at(-1) ?? 'Introduction'
  // Re-emit only scalar metadata we parsed ourselves. `gray-matter` remains in
  // the shared page parser for trusted repository sources, but never receives
  // attacker-controlled YAML aliases from a public URL.
  const raw = [
    '---',
    `title: ${JSON.stringify(title)}`,
    ...(parsed.description ? [`description: ${JSON.stringify(parsed.description)}`] : []),
    '---',
    '',
    parsed.content,
  ].join('\n')
  return parseMarkdownPage({ id, raw, source: document.finalUrl.toString() })
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
  const scopePath = docsScopePath(source)
  const initial = await fetcher(source, { accept: 'text/markdown,text/html,application/xhtml+xml;q=0.9' })
  if (!isInScope(initial.finalUrl, source, scopePath)) {
    throw new Error('The documentation URL redirected outside the submitted docs origin or path.')
  }
  const platform = detectUrlPlatform(initial)
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
  const seenIds = new Set<string>()
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
      const id = pageIdForUrl(document.finalUrl, scopePath)
        ?? pageIdForUrl(candidate, scopePath)
      if (!id) return { candidate, page: null, links: [] as Array<string>, failure: false }
      if (/(?:markdown|text\/plain)/i.test(document.contentType) || /\.mdx?$/i.test(document.finalUrl.pathname)) {
        return {
          candidate,
          page: markdownPage(document, id),
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
      if (result.page && !seenIds.has(result.page.id) && pages.length < maxPages) {
        pages.push(result.page)
        seenIds.add(result.page.id)
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
    page.body = rewriteInternalLinks(page.body, new URL(page.source), source, scopePath, importedIds)
  }
  if (isByteBudgetExhausted) {
    warnings.push({ code: 'limit-reached', message: `Import stopped after reaching the ${Math.round(maxTotalBytes / 1_000_000)} MB content budget.` })
  } else if (queue.length > 0 || queued.size >= MAX_DISCOVERED_URLS) {
    warnings.push({ code: 'limit-reached', message: `Import stopped after ${pages.length} pages; narrow the URL or raise the caller limit to import more.` })
  }
  const docsConfig = buildNavigationFromPages(pages)
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
    assets: [],
    docsConfig,
    warnings,
    stats: {
      discovered: visited.size,
      imported: pages.length,
      skipped: Math.max(0, visited.size - pages.length),
    },
  }
}
