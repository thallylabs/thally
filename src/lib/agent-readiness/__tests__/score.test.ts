import { describe, expect, it } from 'vitest'
import { CHECK_WEIGHTS, MAX_OFFENDERS, scoreAgentReadiness, type ScoreOptions } from '@/lib/agent-readiness/score'
import type { OperationExampleFact, PageFact, RetrievalFacts } from '@/lib/agent-readiness/types'

const NOW = new Date('2026-10-01T00:00:00Z')

function perfectPage(overrides: Partial<PageFact> = {}): PageFact {
  const pageId = overrides.pageId ?? 'guides/auth'
  return {
    pageId,
    href: `/${pageId}`,
    title: 'Authentication',
    description: `How to authenticate requests to ${pageId} with scoped API tokens.`,
    keywords: ['auth', 'tokens'],
    hasContentDoc: true,
    headingsCount: 4,
    headingDepths: [2, 3, 2, 3],
    textLength: 1200,
    contentLength: 1400,
    approxTokens: 600,
    largestSection: { title: 'Tokens', approxTokens: 200 },
    codeBlocksCount: 2,
    untaggedCodeBlocks: 0,
    inNav: true,
    isApi: false,
    hasOpenApiSpec: false,
    hasManualOperation: false,
    jsonLdIssues: [],
    brokenLinks: [],
    ...overrides,
  }
}

function site(count = 2, overrides: (index: number) => Partial<PageFact> = () => ({})): Array<PageFact> {
  return Array.from({ length: count }, (_, index) => perfectPage({ pageId: `page-${index}`, ...overrides(index) }))
}

function score(pages: Array<PageFact>, options: ScoreOptions = {}) {
  return scoreAgentReadiness(pages, { now: NOW, ...options })
}

function check(pages: Array<PageFact>, id: string, options: ScoreOptions = {}) {
  const sub = score(pages, options).subscores.find((candidate) => candidate.id === id)
  if (!sub) throw new Error(`missing check ${id}`)
  return sub
}

function operation(overrides: Partial<OperationExampleFact> = {}): OperationExampleFact {
  return {
    key: 'default:POST /users',
    href: '/api/default/users/post',
    title: 'Create a user',
    hasRequestBody: true,
    hasRequestExample: true,
    hasSuccessContent: true,
    hasResponseExample: true,
    ...overrides,
  }
}

describe('scoreAgentReadiness v2', () => {
  it('gives a perfect site a top score, grade A, and methodology version 2', () => {
    const report = score(site())
    expect(report).toMatchObject({ version: 2, score: 100, grade: 'A', totalPages: 2 })
    for (const sub of report.subscores) expect(['pass', 'skip']).toContain(sub.status)
  })

  it('is deterministic for identical input and clock', () => {
    const pages = site(3, (i) => ({ lastVerified: `2026-0${i + 1}-01` }))
    expect(score(pages)).toEqual(score(pages))
  })

  it('reports stable check ids with weights that sum to 1 across always-on checks', () => {
    const ids = score(site()).subscores.map((sub) => sub.id)
    expect(ids).toEqual([
      'metadata', 'internal_links', 'heading_structure', 'code_language_tags', 'openapi_examples',
      'structured_data', 'page_size', 'freshness', 'content_quality', 'openapi', 'discovery',
      'machine_readability', 'retrieval_eval',
    ])
    const optional = new Set(['retrieval_eval', 'agent_success'])
    const coreWeight = Object.entries(CHECK_WEIGHTS)
      .filter(([id]) => !optional.has(id))
      .reduce((sum, [, weight]) => sum + weight, 0)
    expect(coreWeight).toBeCloseTo(1, 10)
  })

  it('every check carries a status, fix hint, and affected count', () => {
    for (const sub of score(site()).subscores) {
      expect(sub.status).toBeDefined()
      expect(sub.fixHint).toBeTruthy()
      expect(sub.affectedCount).toBe(0)
    }
  })

  it('excludes unavailable checks from the weighting and reports them as passing skips', () => {
    const report = score(site())
    const skipped = report.subscores.filter((sub) => !sub.available)
    expect(skipped.map((sub) => sub.id)).toEqual(['openapi_examples', 'freshness', 'openapi', 'retrieval_eval'])
    for (const sub of skipped) expect(sub).toMatchObject({ status: 'skip', score: 1, offenders: [] })
  })

  describe('metadata (description quality)', () => {
    it('fails a missing description and warns on short, duplicate, or title-repeating ones', () => {
      const pages = [
        perfectPage({ pageId: 'missing', description: '' }),
        perfectPage({ pageId: 'short', description: 'Too short.' }),
        perfectPage({ pageId: 'dup-a', description: 'A shared description that two different pages both happen to use.' }),
        perfectPage({ pageId: 'dup-b', description: 'A shared description that two different pages both happen to use.' }),
        perfectPage({ pageId: 'echo', title: 'Configure the sidebar navigation for a docs site', description: 'Configure the sidebar navigation for a docs site' }),
        perfectPage({ pageId: 'good' }),
      ]
      const metadata = check(pages, 'metadata')
      const reasons = Object.fromEntries(metadata.offenders.map((o) => [o.pageId, o.reason]))
      expect(reasons.missing).toBe('missing description')
      expect(reasons.short).toMatch(/under 50/)
      expect(reasons['dup-a']).toMatch(/duplicates/)
      expect(reasons['dup-b']).toMatch(/duplicates/)
      expect(reasons.echo).toMatch(/repeats the title/)
      expect(reasons.good).toBeUndefined()
      // 1 fail + 4 warns over 6 pages.
      expect(metadata.score).toBeCloseTo(1 - (1 + 4 * 0.5) / 6)
      expect(metadata.offenders[0].pageId).toBe('missing')
    })

    it('no longer penalizes derived keywords (v1 tautology)', () => {
      expect(check([perfectPage({ keywords: [] })], 'metadata').score).toBe(1)
    })
  })

  describe('internal_links', () => {
    it('fails pages with dead links, warns on missing anchors, one offender per page', () => {
      const pages = [
        perfectPage({ pageId: 'dead', brokenLinks: [{ target: '/nope', kind: 'page' }, { target: '/gone#x', kind: 'page' }] }),
        perfectPage({ pageId: 'anchor', brokenLinks: [{ target: '#missing', kind: 'anchor' }] }),
        perfectPage({ pageId: 'ok' }),
      ]
      const links = check(pages, 'internal_links')
      expect(links.offenders).toHaveLength(2)
      expect(links.offenders[0]).toMatchObject({ pageId: 'dead', reason: '2 broken links: /nope, /gone#x' })
      expect(links.offenders[1]).toMatchObject({ pageId: 'anchor', reason: '1 missing anchor: #missing' })
      expect(links.score).toBeCloseTo(1 - 1.5 / 3)
      expect(links.status).toBe('warn')
    })
  })

  describe('heading_structure', () => {
    it('fails long pages without headings and warns on oversized sections and skipped levels', () => {
      const pages = [
        perfectPage({ pageId: 'wall', headingsCount: 0, headingDepths: [], textLength: 4000 }),
        perfectPage({ pageId: 'short-flat', headingsCount: 0, headingDepths: [], textLength: 400 }),
        perfectPage({ pageId: 'big', largestSection: { title: 'Everything', approxTokens: 2400 } }),
        perfectPage({ pageId: 'skip', headingDepths: [2, 4] }),
      ]
      const headings = check(pages, 'heading_structure')
      const reasons = Object.fromEntries(headings.offenders.map((o) => [o.pageId, o.reason]))
      expect(reasons.wall).toMatch(/no headings/)
      expect(reasons['short-flat']).toBeUndefined()
      expect(reasons.big).toMatch(/"Everything" is ~2400 tokens/)
      expect(reasons.skip).toMatch(/h2 to h4/)
    })
  })

  describe('code_language_tags', () => {
    it('scores the share of tagged blocks across the site', () => {
      const pages = [
        perfectPage({ pageId: 'a', codeBlocksCount: 8, untaggedCodeBlocks: 2 }),
        perfectPage({ pageId: 'b', codeBlocksCount: 2, untaggedCodeBlocks: 0 }),
      ]
      const tags = check(pages, 'code_language_tags')
      expect(tags.score).toBeCloseTo(0.8)
      expect(tags.offenders).toEqual([expect.objectContaining({ pageId: 'a', reason: '2 of 8 code blocks have no language tag' })])
    })

    it('skips rather than guesses when the engine cannot tell tagged from untagged', () => {
      const tags = check([perfectPage({ untaggedCodeBlocks: undefined })], 'code_language_tags')
      expect(tags).toMatchObject({ available: false, status: 'skip' })
    })

    it('skips sites without code', () => {
      expect(check([perfectPage({ codeBlocksCount: 0 })], 'code_language_tags').available).toBe(false)
    })
  })

  describe('structured_data', () => {
    it('fails invalid JSON-LD and warns on degraded JSON-LD', () => {
      const pages = [
        perfectPage({ pageId: 'bad-date', jsonLdIssues: [{ severity: 'fail', message: 'dateModified is not ISO' }] }),
        perfectPage({ pageId: 'long', jsonLdIssues: [{ severity: 'warn', message: 'headline is 140 characters' }] }),
      ]
      const structured = check(pages, 'structured_data')
      expect(structured.score).toBeCloseTo(1 - 1.5 / 2)
      expect(structured.offenders.map((o) => o.pageId)).toEqual(['bad-date', 'long'])
    })

    it('no longer double-counts a missing description', () => {
      const report = score([perfectPage({ description: '' })])
      expect(report.subscores.find((sub) => sub.id === 'structured_data')?.score).toBe(1)
    })
  })

  describe('page_size', () => {
    it('warns past the budget and fails past the limit', () => {
      const pages = [
        perfectPage({ pageId: 'ok', approxTokens: 9_000 }),
        perfectPage({ pageId: 'big', approxTokens: 12_000 }),
        perfectPage({ pageId: 'huge', approxTokens: 40_000 }),
      ]
      const size = check(pages, 'page_size')
      expect(size.offenders.map((o) => [o.pageId, o.reason])).toEqual([
        ['huge', '~40000 tokens (over the 25000 limit)'],
        ['big', '~12000 tokens (over the 10000 budget)'],
      ])
    })
  })

  describe('freshness', () => {
    it('is unavailable until some page declares lastVerified', () => {
      expect(check(site(), 'freshness')).toMatchObject({ available: false, status: 'skip' })
    })

    it('scores staleness of verified pages only', () => {
      const pages = [
        perfectPage({ pageId: 'fresh', lastVerified: '2026-09-01' }),
        perfectPage({ pageId: 'aging', lastVerified: '2026-01-01' }),
        perfectPage({ pageId: 'stale', lastVerified: '2024-01-01' }),
        perfectPage({ pageId: 'bogus', lastVerified: 'last week' }),
        perfectPage({ pageId: 'future', lastVerified: '2027-01-01' }),
        perfectPage({ pageId: 'unverified' }),
      ]
      const freshness = check(pages, 'freshness')
      const reasons = Object.fromEntries(freshness.offenders.map((o) => [o.pageId, o.reason]))
      expect(reasons.fresh).toBeUndefined()
      expect(reasons.unverified).toBeUndefined()
      expect(reasons.aging).toMatch(/273 days ago/)
      expect(reasons.stale).toMatch(/days ago/)
      expect(reasons.bogus).toMatch(/not a valid/)
      expect(reasons.future).toMatch(/not a valid/)
      expect(freshness.score).toBeCloseTo(1 - 3.5 / 5)
      expect(freshness.detail).toContain('5/6 pages declare lastVerified')
    })

    it('never lowers the score when one more page is freshly verified', () => {
      const before = score(site(4))
      const after = score(site(4, (i) => (i === 0 ? { lastVerified: '2026-09-15' } : {})))
      expect(after.score).toBeGreaterThanOrEqual(before.score)
    })
  })

  it('content_quality flags thin pages using prose plus code', () => {
    const quality = check([
      perfectPage({ pageId: 'thin', textLength: 40, contentLength: 60 }),
      perfectPage({ pageId: 'code-heavy', textLength: 40, contentLength: 900 }),
    ], 'content_quality')
    expect(quality.offenders.map((o) => o.pageId)).toEqual(['thin'])
  })

  describe('openapi coverage', () => {
    it('is unavailable without API pages', () => {
      expect(check(site(), 'openapi')).toMatchObject({ available: false, score: 1 })
    })

    it('covers a manual API page by its declared operation, and flags an API page with neither', () => {
      const coverage = (overrides: Partial<PageFact>) => check([perfectPage({ isApi: true, ...overrides })], 'openapi')
      expect(coverage({ hasOpenApiSpec: true }).score).toBe(1)
      expect(coverage({ hasManualOperation: true })).toMatchObject({ score: 1, offenders: [] })
      expect(coverage({})).toMatchObject({ score: 0, offenders: [expect.objectContaining({ reason: 'API page without an OpenAPI operation' })] })
    })
  })

  describe('openapi_examples', () => {
    it('scores request and 2xx response example coverage per operation', () => {
      const operations = [
        operation(),
        operation({ key: 'default:GET /users', href: '/api/default/users/get', title: 'List users', hasRequestBody: false, hasRequestExample: false, hasResponseExample: false }),
        operation({ key: 'default:PUT /users', href: '/api/default/users/put', title: 'Replace users', hasRequestExample: false }),
        operation({ key: 'default:DELETE /users', href: '/api/default/users/delete', title: 'Delete', hasRequestBody: false, hasRequestExample: false, hasSuccessContent: false, hasResponseExample: false }),
      ]
      const examples = check(site(), 'openapi_examples', { operations: { operations } })
      expect(examples.available).toBe(true)
      expect(examples.score).toBeCloseTo(1 - 1.5 / 4)
      expect(examples.offenders).toEqual([
        { pageId: 'default:GET /users', href: '/api/default/users/get', reason: 'List users: missing 2xx response example' },
        { pageId: 'default:PUT /users', href: '/api/default/users/put', reason: 'Replace users: missing request body example' },
      ])
    })

    it('is unavailable when the spec fails to load', () => {
      const examples = check(site(), 'openapi_examples', { operations: { operations: [], error: 'The OpenAPI specification could not be loaded.' } })
      expect(examples).toMatchObject({ available: false, status: 'skip', detail: 'The OpenAPI specification could not be loaded.' })
    })
  })

  describe('retrieval_eval', () => {
    const retrieval = (results: RetrievalFacts['results']): RetrievalFacts => ({ k: 5, results })

    it('scores hit@k and lists the expected page of each miss', () => {
      const facts = retrieval([
        { question: 'How do I log in?', expected: ['/auth'], retrieved: ['/auth'], hit: true, unsearchable: [] },
        { question: 'How do I paginate?', expected: ['/pagination'], retrieved: ['/auth'], hit: false, unsearchable: [] },
      ])
      const sub = check(site(), 'retrieval_eval', { retrieval: facts })
      expect(sub).toMatchObject({ available: true, score: 0.5, status: 'warn' })
      expect(sub.offenders).toEqual([{ pageId: '/pagination', href: '/pagination', reason: '"How do I paginate?" not in top 5' }])
      expect(sub.detail).toContain('hit@5')
      // The optional check now carries weight, so a miss lowers the total.
      expect(score(site(), { retrieval: facts }).score).toBeLessThan(100)
    })

    it('reports questions that expect only unsearchable pages without scoring them', () => {
      const sub = check(site(), 'retrieval_eval', {
        retrieval: retrieval([
          { question: 'Hidden?', expected: ['/hidden'], retrieved: [], hit: false, unsearchable: ['/hidden'] },
          { question: 'Visible?', expected: ['/auth'], retrieved: ['/auth'], hit: true, unsearchable: [] },
        ]),
      })
      expect(sub.score).toBe(1)
      expect(sub.offenders[0].reason).toMatch(/not in the search index/)
      expect(sub.detail).toContain('1 expect only unsearchable pages')
    })

    it('skips without listing offenders when every question expects an unsearchable page', () => {
      const sub = check(site(), 'retrieval_eval', {
        retrieval: retrieval([{ question: 'Hidden?', expected: ['/hidden'], retrieved: [], hit: false, unsearchable: ['/hidden'] }]),
      })
      expect(sub).toMatchObject({ available: false, status: 'skip', offenders: [], affectedCount: 0 })
      expect(sub.detail).toMatch(/expect/)
    })

    it('is unavailable when the search index cannot run', () => {
      expect(check(site(), 'retrieval_eval', { retrieval: { k: 5, results: [], error: 'The local search index could not be built.' } }))
        .toMatchObject({ available: false, status: 'skip' })
    })
  })

  it('includes the analytics signal only when traffic is observed', () => {
    const pages = site()
    expect(score(pages).subscores.some((sub) => sub.id === 'agent_success')).toBe(false)
    const withTraffic = score(pages, { traffic: { agentFetches: 100, agentErrors: 50 } })
    expect(withTraffic.subscores.find((sub) => sub.id === 'agent_success')?.score).toBeCloseTo(0.5)
    expect(withTraffic.score).toBeLessThan(100)
  })

  it('fixing a flagged issue raises the score', () => {
    const broken = site(2, (i) => (i === 1 ? { brokenLinks: [{ target: '/missing', kind: 'page' }] } : {}))
    expect(score(site()).score).toBeGreaterThan(score(broken).score)
  })

  it('bounds offenders and reports the full affected count', () => {
    const pages = site(MAX_OFFENDERS + 10, () => ({ description: '' }))
    const metadata = check(pages, 'metadata')
    expect(metadata.offenders).toHaveLength(MAX_OFFENDERS)
    expect(metadata.affectedCount).toBe(MAX_OFFENDERS + 10)
  })

  it('stays within the limits published-report consumers validate', () => {
    const longReason = 'x'.repeat(2_000)
    const longPath = `/${'p'.repeat(299)}`
    const longKey = `default:GET /${'segment/'.repeat(60)}`
    const report = score(site(3, () => ({ brokenLinks: [{ target: `/${longReason}`, kind: 'page' }] })), {
      traffic: { agentFetches: 10, agentErrors: 1 },
      retrieval: {
        k: 5,
        results: [
          { question: longReason, expected: [longPath], retrieved: [], hit: false, unsearchable: [] },
          { question: 'second', expected: [`${longPath}-b`], retrieved: [], hit: false, unsearchable: [] },
        ],
      },
      operations: {
        operations: [
          operation({ key: longKey, href: `/api/${'h'.repeat(3_000)}`, hasResponseExample: false }),
          operation({ key: `${longKey}x`, hasResponseExample: false }),
        ],
      },
    })
    expect(Number.isInteger(report.score)).toBe(true)
    expect(report.subscores.length).toBeLessThanOrEqual(32)
    for (const sub of report.subscores) {
      expect(sub.weight).toBeGreaterThanOrEqual(0)
      expect(sub.weight).toBeLessThanOrEqual(1)
      expect(sub.score).toBeGreaterThanOrEqual(0)
      expect(sub.score).toBeLessThanOrEqual(1)
      expect(sub.detail.length).toBeLessThanOrEqual(500)
      expect(sub.label.length).toBeLessThanOrEqual(160)
      expect(sub.offenders.length).toBeLessThanOrEqual(1_000)
      for (const offender of sub.offenders) {
        expect(offender.reason.length).toBeLessThanOrEqual(500)
        expect(offender.pageId.length).toBeLessThanOrEqual(240)
        expect(offender.href.length).toBeLessThanOrEqual(2_048)
      }
      expect(new Set(sub.offenders.map((o) => o.pageId)).size).toBe(sub.offenders.length)
    }
  })

  describe('public projection', () => {
    const pages = [
      perfectPage({ pageId: 'public-bad', description: '' }),
      perfectPage({ pageId: 'secret-roadmap', description: '', unlisted: true, inNav: false }),
      perfectPage({ pageId: 'internal-runbook', description: '', unlisted: true }),
    ]

    it('counts unlisted pages without naming them anywhere in the report', () => {
      const report = score(pages, {
        redactUnlistedPages: true,
        retrieval: {
          k: 5,
          results: [{ question: 'Where is the roadmap?', expected: ['/secret-roadmap'], retrieved: [], hit: false, unsearchable: [] }],
        },
      })
      const serialized = JSON.stringify(report)
      expect(serialized).not.toContain('secret-roadmap')
      expect(serialized).not.toContain('internal-runbook')
      expect(serialized).not.toContain('Where is the roadmap?')

      const metadata = report.subscores.find((sub) => sub.id === 'metadata')!
      expect(metadata.offenders.map((o) => o.pageId)).toEqual(['public-bad'])
      expect(metadata.affectedCount).toBe(3)
      expect(metadata.score).toBe(0)
      expect(metadata.detail).toContain('2 hidden or noindex pages excluded from this list')
    })

    it('keeps naming unlisted pages in the local (unredacted) report', () => {
      const metadata = check(pages, 'metadata')
      expect(metadata.offenders.map((o) => o.pageId).sort()).toEqual(['internal-runbook', 'public-bad', 'secret-roadmap'])
      expect(metadata.detail).not.toContain('excluded')
    })

    it('does not penalize intentionally unlisted pages for missing navigation', () => {
      const discovery = check([perfectPage({ pageId: 'a' }), perfectPage({ pageId: 'hidden', inNav: false, unlisted: true })], 'discovery')
      expect(discovery).toMatchObject({ score: 1, offenders: [], detail: '1/1 pages are listed in navigation and llms.txt' })
    })
  })
})
