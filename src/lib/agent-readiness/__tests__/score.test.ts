import { describe, expect, it } from 'vitest'
import { scoreAgentReadiness } from '@/lib/agent-readiness/score'
import type { PageFact } from '@/lib/agent-readiness/types'

function perfectPage(overrides: Partial<PageFact> = {}): PageFact {
  return {
    pageId: 'guides/auth',
    href: '/guides/auth',
    title: 'Authentication',
    description: 'How to authenticate.',
    keywords: ['auth', 'tokens'],
    hasContentDoc: true,
    headingsCount: 4,
    textLength: 1200,
    codeBlocksCount: 2,
    inNav: true,
    isApi: false,
    hasOpenApiSpec: false,
    jsonLdValid: true,
    ...overrides,
  }
}

describe('scoreAgentReadiness', () => {
  it('gives a perfect site a top score and grade A', () => {
    const report = scoreAgentReadiness([perfectPage(), perfectPage({ pageId: 'b', href: '/b' })])
    expect(report.score).toBe(100)
    expect(report.grade).toBe('A')
  })

  it('is deterministic for identical input', () => {
    const pages = [perfectPage(), perfectPage({ pageId: 'b', href: '/b' })]
    expect(scoreAgentReadiness(pages)).toEqual(scoreAgentReadiness(pages))
  })

  it('deducts for missing metadata and lists offending pages', () => {
    const report = scoreAgentReadiness([
      perfectPage(),
      perfectPage({ pageId: 'thin', href: '/thin', description: '', keywords: [], jsonLdValid: false }),
    ])
    expect(report.score).toBeLessThan(100)
    const metadata = report.subscores.find((sub) => sub.id === 'metadata')
    expect(metadata?.offenders.map((o) => o.href)).toContain('/thin')
    const structured = report.subscores.find((sub) => sub.id === 'structured_data')
    expect(structured?.offenders.map((o) => o.href)).toContain('/thin')
  })

  it('fixing a flagged issue raises the score', () => {
    const broken = [perfectPage(), perfectPage({ pageId: 'x', href: '/x', headingsCount: 0, textLength: 10 })]
    const fixed = [perfectPage(), perfectPage({ pageId: 'x', href: '/x' })]
    expect(scoreAgentReadiness(fixed).score).toBeGreaterThan(scoreAgentReadiness(broken).score)
  })

  it('includes the analytics signal only when traffic is observed', () => {
    const pages = [perfectPage()]
    const without = scoreAgentReadiness(pages)
    expect(without.subscores.some((sub) => sub.id === 'agent_success')).toBe(false)

    const withTraffic = scoreAgentReadiness(pages, { traffic: { agentFetches: 100, agentErrors: 50 } })
    const signal = withTraffic.subscores.find((sub) => sub.id === 'agent_success')
    expect(signal?.score).toBeCloseTo(0.5)
    // A 50% agent success rate should drag the otherwise-perfect score below 100.
    expect(withTraffic.score).toBeLessThan(100)
  })

  it('skips OpenAPI deductions when there are no API pages', () => {
    const report = scoreAgentReadiness([perfectPage()])
    const openapi = report.subscores.find((sub) => sub.id === 'openapi')
    expect(openapi?.score).toBe(1)
  })
})
