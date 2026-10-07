/** Public entrypoints for local and deployed agent-readiness evaluation. */

import {
  gatherPageFacts,
  gatherReadinessFacts,
  type GatherOptions,
} from '@/lib/agent-readiness/gather'
import { scoreAgentReadiness, type ScoreOptions } from '@/lib/agent-readiness/score'
import type { AgentReadinessReport } from '@/lib/agent-readiness/types'

/**
 * Compute page-level readiness synchronously from the build-embedded content.
 * Site-level checks that need async sources (OpenAPI examples, golden
 * questions) are reported as skipped; prefer {@link computeLocalAgentReadiness}.
 */
export function computeAgentReadiness(options: ScoreOptions = {}): AgentReadinessReport {
  return scoreAgentReadiness(gatherPageFacts(), options)
}

/**
 * Compute the full report from the build-embedded content — the CLI path
 * (`thally check --agents`). Same scorer as the API route and dashboard, so
 * the score is identical everywhere for the same release.
 */
export async function computeLocalAgentReadiness(
  options: ScoreOptions & Pick<GatherOptions, 'search'> = {},
): Promise<AgentReadinessReport> {
  const { search, ...scoreOptions } = options
  const facts = await gatherReadinessFacts({ source: 'embedded', search })
  return scoreAgentReadiness(facts.pages, { ...scoreOptions, operations: facts.operations, retrieval: facts.retrieval })
}

async function computePublishedUncached(
  options: ScoreOptions & Pick<GatherOptions, 'search'> = {},
): Promise<AgentReadinessReport> {
  const { search, ...scoreOptions } = options
  const facts = await gatherReadinessFacts({ source: 'runtime', search })
  return scoreAgentReadiness(facts.pages, {
    ...scoreOptions,
    operations: facts.operations,
    retrieval: facts.retrieval,
    // The published report is readable by anyone who can reach the site.
    redactUnlistedPages: true,
  })
}

/**
 * Compute the full report from the content source serving the deployed site.
 *
 * Without options this is the published report and is served from the
 * per-process memo, so every public surface (API route, MCP tool) shares one
 * bounded computation. Callers that pass options get a fresh evaluation.
 * Either way the report is public: unlisted pages are counted, never named.
 */
export async function computePublishedAgentReadiness(
  options: ScoreOptions & Pick<GatherOptions, 'search'> = {},
): Promise<AgentReadinessReport> {
  if (Object.keys(options).length === 0) return (await getCachedPublishedAgentReadiness()).report
  return computePublishedUncached(options)
}

/** Matches the public route's shared-cache lifetime. */
export const PUBLISHED_READINESS_TTL_MS = 300_000

export interface CachedReadinessReport {
  report: AgentReadinessReport
  /** ISO time the report was computed (not served). */
  asOf: string
}

let cachedReport: { expiresAt: number; value: Promise<CachedReadinessReport> } | null = null

/**
 * The published report, memoized per process for {@link PUBLISHED_READINESS_TTL_MS}.
 *
 * The report reads every page, so an unauthenticated route must not compute
 * it per request. Concurrent callers share one in-flight computation, and a
 * failed computation is evicted immediately so the next request retries.
 */
export function getCachedPublishedAgentReadiness(nowMs: number = Date.now()): Promise<CachedReadinessReport> {
  if (cachedReport && cachedReport.expiresAt > nowMs) return cachedReport.value
  const value = computePublishedUncached().then((report) => ({
    report,
    asOf: new Date().toISOString(),
  }))
  const entry = { expiresAt: nowMs + PUBLISHED_READINESS_TTL_MS, value }
  cachedReport = entry
  value.catch(() => {
    if (cachedReport === entry) cachedReport = null
  })
  return value
}

/** Test seam: drop the memoized published report. */
export function resetPublishedReadinessCache(): void {
  cachedReport = null
}

export { scoreAgentReadiness, CHECK_WEIGHTS } from '@/lib/agent-readiness/score'
export { gatherPageFacts, gatherReadinessFacts, loadPageFacts } from '@/lib/agent-readiness/gather'
export { READINESS_METHODOLOGY_VERSION } from '@/lib/agent-readiness/types'
export type {
  AgentReadinessReport,
  SubscoreResult,
  PageFact,
  ReadinessOffender,
  ReadinessStatus,
  AgentTrafficFacts,
  OperationFacts,
  RetrievalFacts,
} from '@/lib/agent-readiness/types'
