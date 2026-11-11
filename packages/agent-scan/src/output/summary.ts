/**
 * Aggregate statistics for `summary.json`. Deterministic for a given set of
 * results: `generatedAt` is the latest `scannedAt`, and every block is
 * computed for all sites and again excluding Thally-hosted sites.
 */

import { methodology } from '../methodology/methodology.js'
import type { SiteResult } from '../types.js'

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const value = sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
  return Math.round(value * 100) / 100
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1
  return out
}

function checkValue(result: SiteResult, id: string): number | null {
  return result.checks.find((check) => check.id === id)?.value ?? null
}

function block(results: SiteResult[]) {
  const ok = results.filter((result) => result.status === 'ok')
  const scores = ok.map((result) => result.score).filter((score): score is number => score !== null).sort((a, b) => a - b)
  const histogram: Record<string, number> = {}
  for (let bucket = 0; bucket < 100; bucket += 10) histogram[`${bucket}-${bucket === 90 ? 100 : bucket + 9}`] = 0
  for (const score of scores) {
    const bucket = Math.min(90, Math.floor(score / 10) * 10)
    histogram[`${bucket}-${bucket === 90 ? 100 : bucket + 9}`]++
  }
  const checks: Record<string, { applicable: number; meanValue: number | null; passShare: number | null }> = {}
  for (const spec of methodology.checks) {
    const values = ok.map((result) => checkValue(result, spec.id)).filter((value): value is number => value !== null)
    checks[spec.id] = {
      applicable: values.length,
      meanValue: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
      passShare: values.length ? round(values.filter((value) => value === 1).length / values.length) : null,
    }
  }
  const passCount = (id: string) => ok.filter((result) => checkValue(result, id) === 1).length
  return {
    sites: results.length,
    byStatus: countBy(results, (result) => result.status),
    byReason: countBy(results.filter((result) => result.reason !== null), (result) => result.reason ?? ''),
    grades: countBy(ok.filter((result) => result.grade !== null), (result) => result.grade ?? ''),
    score: {
      n: scores.length,
      mean: scores.length ? round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
      median: quantile(scores, 0.5),
      p25: quantile(scores, 0.25),
      p75: quantile(scores, 0.75),
      histogram,
    },
    checks,
    researchQuestions: {
      okSites: ok.length,
      llmsTxt: passCount('discovery.llms_txt'),
      llmsFullTxt: passCount('discovery.llms_full_txt'),
      alternate: passCount('retrieval.alternate'),
      agentManifest: passCount('discovery.agent_manifest'),
      serverRenderedAllPages: passCount('retrieval.server_rendered'),
      parityTitle: passCount('parity.title'),
      parityTitleApplicable: ok.filter((result) => checkValue(result, 'parity.title') !== null).length,
      parityDescription: passCount('parity.description'),
      parityDescriptionApplicable: ok.filter((result) => checkValue(result, 'parity.description') !== null).length,
    },
  }
}

/** Build the summary document for a set of results. */
export function summarize(results: SiteResult[]) {
  const generatedAt = results.reduce<string | null>((latest, result) => (latest === null || result.scannedAt > latest ? result.scannedAt : latest), null)
  const highConfidence = results.filter((result) => result.status === 'ok' && result.platform.confidence === 'high')
  const platforms: Record<string, { sites: number; meanScore: number | null }> = {}
  for (const name of [...new Set(highConfidence.map((result) => result.platform.platform))].sort()) {
    const scores = highConfidence.filter((result) => result.platform.platform === name).map((result) => result.score ?? 0)
    platforms[name] = { sites: scores.length, meanScore: scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : null }
  }
  return {
    methodology: { id: methodology.id, version: methodology.version },
    generatedAt,
    thallyHostedSites: results.filter((result) => result.thallyHosted).length,
    all: block(results),
    excludingThallyHosted: block(results.filter((result) => !result.thallyHosted)),
    platformsHighConfidence: platforms,
    notes: [
      'Platform statistics include only sites detected with high confidence and are descriptive.',
      'thallyHosted means the site runs the Thally engine; managed and self-hosted sites are not distinguished.',
    ],
  }
}
