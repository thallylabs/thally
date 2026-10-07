/**
 * Contracts for the Agent Readiness Score (methodology v2).
 *
 * Facts are gathered once from the canonical content graph and scored by pure
 * functions, so the API route, dashboard, MCP tool, and CLI agree exactly.
 * Report fields added in v2 are optional in these types: published consumers
 * (and older copies of this module) parse v1 reports with the same shape, and
 * a persisted snapshot store keys history on the stable `SubscoreResult.id`.
 */

/** Report methodology version. Bump whenever check semantics or weights change. */
export const READINESS_METHODOLOGY_VERSION = 2

/** A structured-data defect in the JSON-LD a page actually emits. */
export interface JsonLdIssue {
  severity: 'warn' | 'fail'
  message: string
}

/** One internal link that does not resolve to a published page or anchor. */
export interface BrokenLinkFact {
  target: string
  kind: 'page' | 'anchor'
}

/** Deterministic facts about a single page, derived from the content graph. */
export interface PageFact {
  pageId: string
  href: string
  title: string
  description: string
  keywords: Array<string>
  hasContentDoc: boolean
  headingsCount: number
  textLength: number
  codeBlocksCount: number
  inNav: boolean
  isApi: boolean
  hasOpenApiSpec: boolean
  /** A manual `api:` page: it declares its own operation and has no spec. */
  hasManualOperation: boolean
  /**
   * @deprecated v1 only: title-and-description presence, which duplicated the
   * metadata signal. v2 validates the emitted payload (`jsonLdIssues`).
   */
  jsonLdValid?: boolean
  /** Heading depths in document order (for skipped-level detection). */
  headingDepths?: Array<number>
  /** Characters of prose plus code; a page under the thin-content floor has little to retrieve. */
  contentLength?: number
  /** Approximate token size of the page's Markdown projection. */
  approxTokens?: number
  /** Largest heading-bounded section, approximate tokens, and its title. */
  largestSection?: { title: string; approxTokens: number }
  /** Code fences without a declared language; undefined when the engine cannot tell. */
  untaggedCodeBlocks?: number
  /** Problems in the JSON-LD this page emits. Empty means valid. */
  jsonLdIssues?: Array<JsonLdIssue>
  /** Internal links and anchors that do not resolve (bounded per page). */
  brokenLinks?: Array<BrokenLinkFact>
  /** Public provenance: ISO date a human last confirmed the page is accurate. */
  lastVerified?: string
  /**
   * Withheld from public listings (hidden, noindex, …); see
   * `isPubliclyListedPage`. The public report counts but never names it.
   */
  unlisted?: boolean
}

/** Example coverage for one published OpenAPI operation. */
export interface OperationExampleFact {
  /** Stable operation key (`METHOD /path` scoped by spec). */
  key: string
  href: string
  title: string
  /** True when the operation accepts a request body. */
  hasRequestBody: boolean
  hasRequestExample: boolean
  /** True when at least one 2xx response returns content. */
  hasSuccessContent: boolean
  hasResponseExample: boolean
}

/** Result of one golden question run against the local search index. */
export interface GoldenQuestionResult {
  question: string
  /** Expected page hrefs, normalized. */
  expected: Array<string>
  /** Top-k hrefs returned by search. */
  retrieved: Array<string>
  hit: boolean
  /** Expected pages that are excluded from search (noindex, hidden, unknown). */
  unsearchable: Array<string>
}

/** Golden-question evaluation over the search index (only when configured). */
export interface RetrievalFacts {
  k: number
  results: Array<GoldenQuestionResult>
  /** Set when the evaluation could not run; the check is then reported unavailable. */
  error?: string
}

/** OpenAPI operations loaded for example coverage; `error` marks a spec that failed to load. */
export interface OperationFacts {
  operations: Array<OperationExampleFact>
  error?: string
}

/** Optional, analytics-derived signal (graceful when analytics is absent). */
export interface AgentTrafficFacts {
  agentFetches: number
  agentErrors: number
}

export interface ReadinessOffender {
  pageId: string
  href: string
  reason: string
}

/** Check outcome. `skip` marks a check that does not apply to this site. */
export type ReadinessStatus = 'pass' | 'warn' | 'fail' | 'skip'

export interface SubscoreResult {
  /** Stable check id; never reused for different semantics. */
  id: string
  label: string
  /** Nominal weight (0..1). Unavailable checks are excluded from the total. */
  weight: number
  /** 0..1 */
  score: number
  available: boolean
  /** Human summary of the result. */
  detail: string
  /** Concrete, fixable pages that pulled the subscore down (bounded). */
  offenders: Array<ReadinessOffender>
  /** v2: pass / warn / fail, or skip when unavailable. */
  status?: ReadinessStatus
  /** v2: the concrete action that raises this check's score. */
  fixHint?: string
  /** v2: total affected pages or operations; `offenders` is truncated to a bounded list. */
  affectedCount?: number
}

export interface AgentReadinessReport {
  /** v2: methodology version; absent on v1 reports. */
  version?: number
  /** 0..100 */
  score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  totalPages: number
  subscores: Array<SubscoreResult>
}
