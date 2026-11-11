/**
 * Loads and validates the frozen methodology spec. The JSON file is the single
 * source of weights, grades, probe paths and limits; no TypeScript module may
 * restate them, so the code and the published spec cannot drift apart.
 */

import spec from './methodology-v1.0.json' with { type: 'json' }

import type { CategoryId, Grade } from '../types.js'

/** One check entry in the methodology spec. */
export interface MethodologyCheck {
  id: string
  category: CategoryId
  weight: number
  scored: boolean
  scope: 'site' | 'page'
  rule: string
  notApplicableWhen: string | null
}

/** One category entry in the methodology spec. */
export interface MethodologyCategory {
  id: CategoryId
  name: string
  weight: number
}

/** The parsed methodology spec. */
export interface Methodology {
  id: 'thally-agent-scan'
  version: '1.0'
  frozenOn: string
  license: string
  description: string
  userAgent: string
  robotsProductToken: string
  limits: {
    requestsPerSite: number
    minIntervalMsPerHost: number
    timeoutMs: number
    retries: number
    maxRedirects: number
    maxBodyBytes: number
    samplePages: number
  }
  scoring: Record<string, string>
  probes: {
    llmsTxt: string
    wellKnown: string[]
    aiBotTokens: string[]
    alternateVariants: Array<'link_alternate' | 'dot_md' | 'accept_negotiation' | 'format_json'>
    llmsFullMinBytes: number
    llmsFullPrefixBytes: number
    sitemapMaxIndexChildren: number
    sitemapPaths: string[]
    jsonLdPageTypes: string[]
    serverRenderedMinChars: number
    maxStatusRedirects: number
  }
  sampling: { pages: number; order: string; method: string; robotsFiltered: boolean; fallback: string }
  grades: Array<{ grade: Grade; min: number }>
  categories: MethodologyCategory[]
  checks: MethodologyCheck[]
}

const CATEGORY_IDS: ReadonlySet<string> = new Set(['discovery', 'identity', 'structure', 'retrieval', 'trust', 'parity'])
const GRADES: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D', 'F'])

/**
 * Validate a methodology object. Throws on the first violation: an invalid
 * spec is a programmer error, never a per-site failure.
 */
export function validateMethodology(candidate: unknown): Methodology {
  const m = candidate as Methodology
  if (!m || typeof m !== 'object') throw new Error('methodology: not an object')
  if (m.id !== 'thally-agent-scan') throw new Error('methodology: unexpected id')
  if (typeof m.version !== 'string' || !m.version) throw new Error('methodology: missing version')
  if (!Array.isArray(m.categories) || m.categories.length === 0) throw new Error('methodology: no categories')
  const categoryIds = new Set<string>()
  for (const category of m.categories) {
    if (!CATEGORY_IDS.has(category.id)) throw new Error(`methodology: unknown category ${category.id}`)
    if (categoryIds.has(category.id)) throw new Error(`methodology: duplicate category ${category.id}`)
    if (!(typeof category.weight === 'number' && category.weight > 0)) {
      throw new Error(`methodology: category ${category.id} weight must be positive`)
    }
    categoryIds.add(category.id)
  }
  if (!Array.isArray(m.checks) || m.checks.length === 0) throw new Error('methodology: no checks')
  const checkIds = new Set<string>()
  for (const check of m.checks) {
    if (checkIds.has(check.id)) throw new Error(`methodology: duplicate check ${check.id}`)
    if (!categoryIds.has(check.category)) throw new Error(`methodology: check ${check.id} names unknown category`)
    if (!(typeof check.weight === 'number' && check.weight > 0)) {
      throw new Error(`methodology: check ${check.id} weight must be positive`)
    }
    if (typeof check.scored !== 'boolean') throw new Error(`methodology: check ${check.id} scored must be boolean`)
    if (check.scope !== 'site' && check.scope !== 'page') throw new Error(`methodology: check ${check.id} has bad scope`)
    checkIds.add(check.id)
  }
  if (!Array.isArray(m.grades) || m.grades.length === 0) throw new Error('methodology: no grades')
  for (let i = 0; i < m.grades.length; i++) {
    const grade = m.grades[i]
    if (!GRADES.has(grade.grade)) throw new Error(`methodology: unknown grade ${grade.grade}`)
    if (i > 0 && !(grade.min < m.grades[i - 1].min)) throw new Error('methodology: grades must be strictly descending')
  }
  if (m.grades[m.grades.length - 1].min !== 0) throw new Error('methodology: last grade must start at 0')
  return m
}

/** The frozen methodology spec, validated at module load. */
export const methodology: Methodology = validateMethodology(spec)

/**
 * Map a 0–100 score to a letter grade using the methodology thresholds, which
 * match the in-product scorer's grade bands.
 */
export function gradeFor(score: number): Grade {
  for (const band of methodology.grades) {
    if (score >= band.min) return band.grade
  }
  return methodology.grades[methodology.grades.length - 1].grade
}
