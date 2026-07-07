import type {
  AgentReadinessReport,
  AgentTrafficFacts,
  PageFact,
  ReadinessOffender,
  SubscoreResult,
} from '@/lib/agent-readiness/types'

const THIN_TEXT_THRESHOLD = 200

interface SignalDefinition {
  id: string
  label: string
  weight: number
  evaluate: (pages: Array<PageFact>) => { score: number; detail: string; offenders: Array<ReadinessOffender> }
}

function ratio(pass: number, total: number): number {
  if (total === 0) return 1
  return pass / total
}

// Each signal returns the fraction of pages that pass plus the offenders that
// failed — so every deduction is explainable and points at fixable pages.
const SIGNALS: Array<SignalDefinition> = [
  {
    id: 'structured_data',
    label: 'Structured data coverage',
    weight: 0.2,
    evaluate: (pages) => {
      const offenders: Array<ReadinessOffender> = []
      for (const page of pages) {
        if (!page.jsonLdValid) {
          offenders.push({ pageId: page.pageId, href: page.href, reason: 'JSON-LD missing required title/description' })
        }
      }
      return {
        score: ratio(pages.length - offenders.length, pages.length),
        detail: `${pages.length - offenders.length}/${pages.length} pages emit valid JSON-LD`,
        offenders,
      }
    },
  },
  {
    id: 'metadata',
    label: 'Metadata completeness',
    weight: 0.2,
    evaluate: (pages) => {
      const offenders: Array<ReadinessOffender> = []
      for (const page of pages) {
        const missing: Array<string> = []
        if (!page.title) missing.push('title')
        if (!page.description) missing.push('description')
        if (page.keywords.length === 0) missing.push('keywords')
        if (missing.length) {
          offenders.push({ pageId: page.pageId, href: page.href, reason: `missing ${missing.join(', ')}` })
        }
      }
      return {
        score: ratio(pages.length - offenders.length, pages.length),
        detail: `${pages.length - offenders.length}/${pages.length} pages have title, description, and keywords`,
        offenders,
      }
    },
  },
  {
    id: 'discovery',
    label: 'Discovery health',
    weight: 0.15,
    evaluate: (pages) => {
      const offenders: Array<ReadinessOffender> = []
      for (const page of pages) {
        if (!page.inNav) {
          offenders.push({ pageId: page.pageId, href: page.href, reason: 'not reachable from navigation / docs-index' })
        }
      }
      return {
        score: ratio(pages.length - offenders.length, pages.length),
        detail: `${pages.length - offenders.length}/${pages.length} pages are discoverable via navigation`,
        offenders,
      }
    },
  },
  {
    id: 'content_quality',
    label: 'Content quality',
    weight: 0.15,
    evaluate: (pages) => {
      const offenders: Array<ReadinessOffender> = []
      for (const page of pages) {
        const issues: Array<string> = []
        if (page.textLength < THIN_TEXT_THRESHOLD) issues.push('thin content')
        if (page.headingsCount === 0) issues.push('no headings')
        if (issues.length) {
          offenders.push({ pageId: page.pageId, href: page.href, reason: issues.join(', ') })
        }
      }
      return {
        score: ratio(pages.length - offenders.length, pages.length),
        detail: `${pages.length - offenders.length}/${pages.length} pages have substantive, structured content`,
        offenders,
      }
    },
  },
  {
    id: 'machine_readability',
    label: 'Machine readability',
    weight: 0.2,
    evaluate: (pages) => {
      const offenders: Array<ReadinessOffender> = []
      for (const page of pages) {
        if (!page.hasContentDoc) {
          offenders.push({ pageId: page.pageId, href: page.href, reason: 'no resolvable source — cannot serve JSON / Markdown / ld+json' })
        }
      }
      return {
        score: ratio(pages.length - offenders.length, pages.length),
        detail: `${pages.length - offenders.length}/${pages.length} pages resolve as JSON, Markdown, and JSON-LD`,
        offenders,
      }
    },
  },
  {
    id: 'openapi',
    label: 'OpenAPI coverage',
    weight: 0.1,
    evaluate: (pages) => {
      const apiPages = pages.filter((page) => page.isApi)
      if (apiPages.length === 0) {
        return { score: 1, detail: 'No API pages to cover', offenders: [] }
      }
      const offenders: Array<ReadinessOffender> = []
      for (const page of apiPages) {
        if (!page.hasOpenApiSpec) {
          offenders.push({ pageId: page.pageId, href: page.href, reason: 'API page without an OpenAPI operation' })
        }
      }
      return {
        score: ratio(apiPages.length - offenders.length, apiPages.length),
        detail: `${apiPages.length - offenders.length}/${apiPages.length} API pages map to an OpenAPI operation`,
        offenders,
      }
    },
  },
]

function gradeFor(score: number): AgentReadinessReport['grade'] {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

export interface ScoreOptions {
  traffic?: AgentTrafficFacts
}

/**
 * Compute a deterministic, explainable 0–100 Agent Readiness Score from page
 * facts. Weights are renormalized over available signals, so the analytics
 * signal is included only when traffic data is provided.
 */
export function scoreAgentReadiness(pages: Array<PageFact>, options: ScoreOptions = {}): AgentReadinessReport {
  const subscores: Array<SubscoreResult> = SIGNALS.map((signal) => {
    const result = signal.evaluate(pages)
    return {
      id: signal.id,
      label: signal.label,
      weight: signal.weight,
      available: true,
      score: result.score,
      detail: result.detail,
      offenders: result.offenders,
    }
  })

  // Optional analytics-derived signal — only counts when traffic is observed.
  if (options.traffic && options.traffic.agentFetches > 0) {
    const { agentFetches, agentErrors } = options.traffic
    const successRate = (agentFetches - agentErrors) / agentFetches
    subscores.push({
      id: 'agent_success',
      label: 'Observed agent success',
      weight: 0.15,
      available: true,
      score: Math.max(0, Math.min(1, successRate)),
      detail: `${agentFetches - agentErrors}/${agentFetches} observed agent fetches succeeded`,
      offenders: [],
    })
  }

  const totalWeight = subscores.reduce((sum, sub) => sum + sub.weight, 0)
  const weighted = subscores.reduce((sum, sub) => sum + sub.score * sub.weight, 0)
  const score = Math.round((weighted / totalWeight) * 100)

  return {
    score,
    grade: gradeFor(score),
    totalPages: pages.length,
    subscores,
  }
}
