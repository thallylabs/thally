/**
 * JSON-LD node selection. Pages often carry site-level nodes (WebSite,
 * Organization, BreadcrumbList) next to the node that describes the page
 * itself. Page-level comparisons use the page node: a node of a page type
 * (from the methodology) whose `url` or `@id` is the page, else the node of
 * the earliest type in the methodology's list (TechArticle before WebPage),
 * and only when there is no page-type node, the first node at all.
 */

import { methodology } from './methodology/methodology.js'
import { sameUrl } from './url.js'

/** A JSON-LD node object. */
export type JsonLdNode = Record<string, unknown>

/** Top-level nodes of a parsed JSON-LD document: objects, or the members of their `@graph`. */
export function topLevelNodes(parsed: unknown): JsonLdNode[] {
  const out: JsonLdNode[] = []
  for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const graph = (item as JsonLdNode)['@graph']
    if (Array.isArray(graph)) {
      for (const member of graph) if (member && typeof member === 'object' && !Array.isArray(member)) out.push(member as JsonLdNode)
    } else out.push(item as JsonLdNode)
  }
  return out
}

function types(node: JsonLdNode): string[] {
  const type = node['@type']
  if (typeof type === 'string') return [type]
  return Array.isArray(type) ? type.filter((item): item is string => typeof item === 'string') : []
}

/** True when the node has one of the methodology's page-level types. */
export function isPageNode(node: JsonLdNode): boolean {
  return types(node).some((type) => methodology.probes.jsonLdPageTypes.includes(type))
}

function refersTo(node: JsonLdNode, pageUrl: string): boolean {
  for (const key of ['url', '@id']) {
    const value = node[key]
    if (typeof value !== 'string') continue
    try {
      const url = new URL(value, pageUrl)
      url.hash = ''
      if (sameUrl(url.href, pageUrl)) return true
    } catch {
      // Not a URL.
    }
  }
  return false
}

/** Select the node that describes the page, or null when there are no nodes. */
export function selectPageNode(nodes: JsonLdNode[], pageUrl: string | null): JsonLdNode | null {
  const pageNodes = nodes.filter(isPageNode)
  if (pageNodes.length > 0) {
    const matching = pageUrl ? pageNodes.find((node) => refersTo(node, pageUrl)) : undefined
    if (matching) return matching
    // Otherwise the most specific page type wins, in methodology order.
    for (const type of methodology.probes.jsonLdPageTypes) {
      const node = pageNodes.find((candidate) => types(candidate).includes(type))
      if (node) return node
    }
  }
  return nodes[0] ?? null
}
