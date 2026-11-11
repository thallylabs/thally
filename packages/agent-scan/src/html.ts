/**
 * Extract every fact the checks need from one HTML body with a single parse.
 * Nothing here executes scripts; the facts describe what a non-rendering
 * HTTP client sees.
 */

import { load, type CheerioAPI } from 'cheerio'

import { normalizeUrl } from './url.js'

/** JSON-LD facts for one page. */
export interface JsonLdFacts {
  /** Number of `application/ld+json` scripts. */
  scripts: number
  /** Every script parsed and every top-level object (or `@graph` node) has a non-empty `@type`. */
  allValid: boolean
  /** Any node at any depth has `dateModified`. */
  hasDateModified: boolean
  /** Any node at any depth has `@type` `Organization`. */
  hasOrganization: boolean
  /** First string `description` among top-level and `@graph` nodes, document order. */
  description: string | null
}

/** Facts derived from one HTML page. */
export interface PageFacts {
  finalUrl: string
  lang: string
  title: string
  metaDescription: string
  /** Resolved hrefs of every `<link rel=canonical>`, document order. */
  canonicals: string[]
  h1Count: number
  /** Text of the first `<h1>`, whitespace-collapsed. */
  firstH1: string
  /** Heading levels inside the main content root, document order. */
  headingLevels: number[]
  /** Length of the main content root text. */
  mainTextLength: number
  articleModifiedTime: boolean
  timeUpdated: boolean
  jsonLd: JsonLdFacts
  footerOwnership: boolean
  correctionLink: boolean
  correctionText: boolean
  /** `<link rel=alternate>` with a markdown or JSON type, resolved, document order. */
  alternates: Array<{ href: string; type: 'text/markdown' | 'application/json' }>
  linkRelMcp: boolean
  /** Same-document `<a href>` targets, resolved and normalized, document order. */
  links: string[]
  /** Platform-detection inputs. */
  generator: string
  assetUrls: string[]
  hasThallyShim: boolean
  hasDocusaurusRoot: boolean
  hasNextraClass: boolean
}

const UPDATED_TEXT = /\b(last\s+)?(updated|modified|edited)\b/i
const COPYRIGHT_TEXT = /©|\(c\)|copyright/i
const CORRECTION_TEXT = /edit (this )?page|suggest (an )?edit|improve this (page|doc)|report an issue|was this (page )?helpful|give feedback/i
const CORRECTION_HREFS = [
  /github\.com\/[^/\s]+\/[^/\s]+\/(edit|blob|tree)\//i,
  /gitlab\.com\/.+\/-\/(edit|blob)\//i,
  /bitbucket\.org\/.+\/src\//i,
]

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function relTokens(value: string | undefined): string[] {
  return (value ?? '').toLowerCase().split(/\s+/).filter(Boolean)
}

function hasType(node: Record<string, unknown>): boolean {
  const type = node['@type']
  if (typeof type === 'string') return type.trim().length > 0
  if (Array.isArray(type)) return type.some((item) => typeof item === 'string' && item.trim().length > 0)
  return false
}

function typeIncludes(node: Record<string, unknown>, wanted: string): boolean {
  const type = node['@type']
  if (typeof type === 'string') return type === wanted
  return Array.isArray(type) && type.includes(wanted)
}

function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
    return
  }
  if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>
    visit(node)
    for (const key of Object.keys(node)) walk(node[key], visit)
  }
}

function readJsonLd($: CheerioAPI): JsonLdFacts {
  const facts: JsonLdFacts = {
    scripts: 0,
    allValid: true,
    hasDateModified: false,
    hasOrganization: false,
    description: null,
  }
  $('script').each((_, element) => {
    const type = ($(element).attr('type') ?? '').split(';')[0].trim().toLowerCase()
    if (type !== 'application/ld+json') return
    facts.scripts++
    let parsed: unknown
    try {
      parsed = JSON.parse($(element).text())
    } catch {
      facts.allValid = false
      return
    }
    const topLevel = Array.isArray(parsed) ? parsed : [parsed]
    for (const item of topLevel) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        facts.allValid = false
        continue
      }
      const node = item as Record<string, unknown>
      const graph = node['@graph']
      const nodes = Array.isArray(graph) ? graph : [node]
      if (Array.isArray(graph) && graph.length === 0) facts.allValid = false
      for (const member of nodes) {
        if (!member || typeof member !== 'object' || !hasType(member as Record<string, unknown>)) {
          facts.allValid = false
          continue
        }
        const description = (member as Record<string, unknown>).description
        if (facts.description === null && typeof description === 'string') facts.description = description
      }
    }
    walk(parsed, (node) => {
      if ('dateModified' in node && node.dateModified) facts.hasDateModified = true
      if (typeIncludes(node, 'Organization')) facts.hasOrganization = true
    })
  })
  if (facts.scripts === 0) facts.allValid = false
  return facts
}

/**
 * Parse one HTML page. `finalUrl` is the URL the body came from after
 * redirects; relative URLs resolve against it (or against `<base href>`).
 */
export function parsePage(html: string, finalUrl: string): PageFacts {
  const $ = load(html)
  const baseHref = $('base[href]').first().attr('href')
  const base = (baseHref && normalizeUrl(baseHref, finalUrl)) || finalUrl
  const resolve = (href: string | undefined): string | null => (href ? normalizeUrl(href.trim(), base) : null)

  const canonicals: string[] = []
  const alternates: PageFacts['alternates'] = []
  let linkRelMcp = false
  const assetUrls: string[] = []
  $('link').each((_, element) => {
    const rel = relTokens($(element).attr('rel'))
    const href = $(element).attr('href')
    if (rel.includes('canonical')) {
      const resolved = resolve(href)
      canonicals.push(resolved ?? '')
    }
    if (rel.includes('alternate')) {
      const type = ($(element).attr('type') ?? '').split(';')[0].trim().toLowerCase()
      const resolved = resolve(href)
      if (resolved && (type === 'text/markdown' || type === 'application/json')) alternates.push({ href: resolved, type })
    }
    if (rel.includes('mcp')) linkRelMcp = true
    if (href) assetUrls.push(href)
  })
  $('script[src], img[src]').each((_, element) => {
    const src = $(element).attr('src')
    if (src) assetUrls.push(src)
  })

  const metaContent = (predicate: (name: string, property: string) => boolean): string => {
    let value = ''
    $('meta').each((_, element) => {
      if (value) return
      const name = ($(element).attr('name') ?? '').toLowerCase()
      const property = ($(element).attr('property') ?? '').toLowerCase()
      if (predicate(name, property)) value = collapse($(element).attr('content') ?? '')
    })
    return value
  }

  const jsonLd = readJsonLd($)
  const hasThallyShim = $('script#thally-runtime-name-shim').length > 0
  const hasDocusaurusRoot = $('div#__docusaurus').length > 0
  const hasNextraClass = $('[class*="nextra"]').length > 0
  const generator = metaContent((name) => name === 'generator')

  const links: string[] = []
  let correctionLink = false
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') ?? ''
    if (CORRECTION_HREFS.some((pattern) => pattern.test(href))) correctionLink = true
    const resolved = resolve(href)
    if (resolved) links.push(resolved)
  })

  // Text-based facts ignore non-rendered content.
  $('script, style, noscript, template, svg').remove()

  let timeUpdated = false
  $('time').each((_, element) => {
    if (timeUpdated) return
    const own = $(element)
    const parent = own.parent()
    const grandparent = parent.parent()
    if ([own, parent, grandparent].some((node) => UPDATED_TEXT.test(collapse(node.text())))) timeUpdated = true
  })

  let footerOwnership = false
  $('footer, [role=contentinfo]').each((_, element) => {
    const node = $(element)
    if (node.find('a[href]').length > 0 && COPYRIGHT_TEXT.test(node.text())) footerOwnership = true
  })

  const bodyText = collapse($('body').text())
  const correctionText = CORRECTION_TEXT.test(bodyText)
  const h1 = $('h1')
  const firstH1 = h1.length > 0 ? collapse(h1.first().text()) : ''
  const h1Count = h1.length

  let main = $('main').first()
  if (main.length === 0) main = $('article').first()
  if (main.length === 0) main = $('[role=main]').first()
  if (main.length === 0) {
    main = $('body').first()
    main.find('header, nav, footer, aside').remove()
  }
  const headingLevels: number[] = []
  main.find('h1, h2, h3, h4, h5, h6').each((_, element) => {
    headingLevels.push(Number((element as { tagName: string }).tagName.slice(1)))
  })

  return {
    finalUrl,
    lang: ($('html').attr('lang') ?? '').trim(),
    title: collapse($('title').first().text()),
    metaDescription: metaContent((name) => name === 'description'),
    canonicals,
    h1Count,
    firstH1,
    headingLevels,
    mainTextLength: collapse(main.text()).length,
    articleModifiedTime: metaContent((_, property) => property === 'article:modified_time') !== '',
    timeUpdated,
    jsonLd,
    footerOwnership,
    correctionLink,
    correctionText,
    alternates,
    linkRelMcp,
    links,
    generator,
    assetUrls,
    hasThallyShim,
    hasDocusaurusRoot,
    hasNextraClass,
  }
}
