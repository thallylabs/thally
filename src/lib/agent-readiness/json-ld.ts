/**
 * Validation of the JSON-LD a documentation page actually emits.
 *
 * Readiness builds each page's payload with the same `buildDocPageJsonLd`
 * call the page route uses, then checks the result against the schema.org
 * expectations agents and search crawlers rely on. Description presence is
 * deliberately not checked here: the `metadata` check owns it, so one missing
 * field never costs a page twice.
 */

import { serializeJsonLd } from '@/lib/json-ld'
import type { JsonLdIssue } from '@/lib/agent-readiness/types'

/** schema.org rich results truncate headlines past this length. */
export const MAX_HEADLINE_LENGTH = 110

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?)?$/

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isAbsoluteHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string' || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** True for an ISO 8601 date or date-time that names a real calendar day. */
export function isIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !ISO_DATE.test(value.trim())) return false
  const [year, month, day] = value.trim().slice(0, 10).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function validateBreadcrumb(node: JsonObject, issues: Array<JsonLdIssue>): void {
  const items = node.itemListElement
  if (!Array.isArray(items) || items.length === 0) {
    issues.push({ severity: 'warn', message: 'BreadcrumbList has no items' })
    return
  }
  items.forEach((item, index) => {
    if (!isObject(item) || item.position !== index + 1) {
      issues.push({ severity: 'warn', message: 'BreadcrumbList positions are not sequential' })
    } else if (typeof item.name !== 'string' || !item.name.trim()) {
      issues.push({ severity: 'warn', message: `breadcrumb item ${index + 1} has no name` })
    } else if (item.item !== undefined && !isAbsoluteHttpUrl(item.item)) {
      issues.push({ severity: 'warn', message: `breadcrumb item ${index + 1} has a non-absolute URL` })
    }
  })
}

/**
 * Validate one page's JSON-LD payload. Returns every defect found; an empty
 * list means the payload is well formed. `fail` defects make the payload
 * unusable or invalid schema.org; `warn` defects degrade it.
 */
export function validateDocJsonLd(payload: unknown): Array<JsonLdIssue> {
  const issues: Array<JsonLdIssue> = []

  let data: unknown
  try {
    // Round-trip through the exact serializer the page uses, so anything the
    // HTML embed cannot carry is caught here rather than in a crawler.
    data = JSON.parse(serializeJsonLd(payload as Record<string, unknown>))
  } catch {
    return [{ severity: 'fail', message: 'JSON-LD does not serialize to valid JSON' }]
  }

  if (!isObject(data) || data['@context'] !== 'https://schema.org') {
    return [{ severity: 'fail', message: 'JSON-LD is missing the https://schema.org @context' }]
  }
  const graph = Array.isArray(data['@graph']) ? data['@graph'].filter(isObject) : []
  const article = graph.find((node) => node['@type'] === 'TechArticle')
  if (!article) return [{ severity: 'fail', message: 'JSON-LD has no TechArticle node' }]

  const headline = typeof article.headline === 'string' ? article.headline.trim() : ''
  if (!headline) {
    issues.push({ severity: 'fail', message: 'TechArticle headline is empty' })
  } else if (headline.length > MAX_HEADLINE_LENGTH) {
    issues.push({
      severity: 'warn',
      message: `headline is ${headline.length} characters (over ${MAX_HEADLINE_LENGTH})`,
    })
  }
  if (!isAbsoluteHttpUrl(article.url)) {
    issues.push({ severity: 'fail', message: 'TechArticle url is not an absolute http(s) URL' })
  }
  if (article.dateModified !== undefined && !isIsoDate(article.dateModified)) {
    issues.push({
      severity: 'fail',
      message: 'dateModified (frontmatter lastUpdated) is not an ISO 8601 date',
    })
  }

  for (const node of graph) {
    if (node['@type'] === 'BreadcrumbList') validateBreadcrumb(node, issues)
  }

  return issues
}
