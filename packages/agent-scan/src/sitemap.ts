/**
 * Sitemap and sitemap-index parsing. The parser is lenient so a sitemap cut
 * off at the size cap still yields the `<loc>` values that arrived intact.
 */

import { load } from 'cheerio'

/** What a sitemap body contained. */
export interface ParsedSitemap {
  kind: 'urlset' | 'sitemapindex' | null
  /** `<loc>` values in document order, trimmed; empty entries dropped. */
  locs: string[]
}

function localName(tag: string): string {
  const colon = tag.indexOf(':')
  return (colon >= 0 ? tag.slice(colon + 1) : tag).toLowerCase()
}

interface XmlNode {
  type: string
  name?: string
  children?: XmlNode[]
  data?: string
}

function textOf(node: XmlNode): string {
  if (node.type === 'text' || node.type === 'cdata') {
    return node.type === 'cdata' ? (node.children ?? []).map(textOf).join('') : node.data ?? ''
  }
  return (node.children ?? []).map(textOf).join('')
}

/**
 * Parse a sitemap body. Only `<url><loc>` (urlset) or `<sitemap><loc>`
 * (index) children of the root count, so extension elements such as
 * `<image:loc>` are ignored.
 */
export function parseSitemap(body: string): ParsedSitemap {
  const $ = load(body, { xml: { xmlMode: true, decodeEntities: true } })
  const root = ($.root().children().toArray() as unknown as XmlNode[]).find((node) => node.type === 'tag')
  if (!root || !root.name) return { kind: null, locs: [] }
  const rootName = localName(root.name)
  if (rootName !== 'urlset' && rootName !== 'sitemapindex') return { kind: null, locs: [] }
  const entryName = rootName === 'urlset' ? 'url' : 'sitemap'
  const locs: string[] = []
  for (const entry of root.children ?? []) {
    if (entry.type !== 'tag' || !entry.name || localName(entry.name) !== entryName) continue
    for (const child of entry.children ?? []) {
      if (child.type !== 'tag' || !child.name || child.name.toLowerCase() !== 'loc') continue
      const value = textOf(child).trim()
      if (value) locs.push(value)
      break
    }
  }
  return { kind: rootName, locs }
}
