/** Flatten site results into `results.csv`. */

import { methodology } from '../methodology/methodology.js'
import type { SiteResult } from '../types.js'
import { toCsv } from './csv.js'

/** Column names of `results.csv`, in order. */
export function resultColumns(): string[] {
  return [
    'input', 'docs_root', 'status', 'reason', 'score', 'grade', 'platform', 'platform_confidence', 'thally_hosted',
    ...methodology.categories.map((category) => `category_${category.id}`),
    ...methodology.checks.flatMap((check) => [check.id, `${check.id}_status`]),
    'requests_used', 'sample_source', 'pages_sampled', 'scanned_at',
  ]
}

/** One flattened row per result, in the given order. */
export function resultsToCsv(results: SiteResult[]): string {
  const rows = results.map((result) => {
    const categories = new Map(result.categories.map((category) => [category.id, category.score]))
    const checks = new Map(result.checks.map((check) => [check.id, check]))
    return [
      result.input, result.docsRoot, result.status, result.reason, result.score, result.grade,
      result.platform.platform, result.platform.confidence, result.thallyHosted,
      ...methodology.categories.map((category) => categories.get(category.id) ?? null),
      ...methodology.checks.flatMap((spec) => {
        const check = checks.get(spec.id)
        return [check?.value ?? null, check?.status ?? null]
      }),
      result.requests.used, result.sample.source, result.sample.pages.length, result.scannedAt,
    ]
  })
  return toCsv([resultColumns(), ...rows])
}
