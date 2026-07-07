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
  /** JSON-LD can be emitted with the required schema.org fields. */
  jsonLdValid: boolean
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

export interface SubscoreResult {
  id: string
  label: string
  weight: number
  /** 0..1 */
  score: number
  available: boolean
  detail: string
  /** Concrete, fixable pages that pulled the subscore down. */
  offenders: Array<ReadinessOffender>
}

export interface AgentReadinessReport {
  /** 0..100 */
  score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  totalPages: number
  subscores: Array<SubscoreResult>
}
