/** The published report is computed at most once per cache window per process. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ gatherReadinessFacts: vi.fn() }))

vi.mock('@/lib/agent-readiness/gather', () => ({
  gatherReadinessFacts: mocks.gatherReadinessFacts,
  gatherPageFacts: vi.fn(() => []),
  loadPageFacts: vi.fn(async () => []),
}))

import {
  computePublishedAgentReadiness,
  getCachedPublishedAgentReadiness,
  PUBLISHED_READINESS_TTL_MS,
  resetPublishedReadinessCache,
} from '@/lib/agent-readiness'

describe('getCachedPublishedAgentReadiness', () => {
  beforeEach(() => {
    resetPublishedReadinessCache()
    mocks.gatherReadinessFacts.mockReset()
    mocks.gatherReadinessFacts.mockResolvedValue({ pages: [], operations: null, retrieval: null })
  })

  it('shares one in-flight computation and reuses it until the window expires', async () => {
    const [first, second] = await Promise.all([
      getCachedPublishedAgentReadiness(1_000),
      getCachedPublishedAgentReadiness(1_001),
    ])
    expect(first).toBe(second)
    expect(first.report.version).toBe(2)
    await getCachedPublishedAgentReadiness(1_000 + PUBLISHED_READINESS_TTL_MS - 1)
    expect(mocks.gatherReadinessFacts).toHaveBeenCalledTimes(1)
    expect(mocks.gatherReadinessFacts).toHaveBeenCalledWith({ source: 'runtime', search: undefined })

    await getCachedPublishedAgentReadiness(1_000 + PUBLISHED_READINESS_TTL_MS)
    expect(mocks.gatherReadinessFacts).toHaveBeenCalledTimes(2)
  })

  it('evicts a failed computation so the next request retries', async () => {
    mocks.gatherReadinessFacts.mockRejectedValueOnce(new Error('content source down'))
    await expect(getCachedPublishedAgentReadiness(5_000)).rejects.toThrow('content source down')
    await expect(getCachedPublishedAgentReadiness(5_001)).resolves.toMatchObject({ report: { version: 2 } })
    expect(mocks.gatherReadinessFacts).toHaveBeenCalledTimes(2)
  })

  it('serves no-argument published calls (API route, MCP tool) from the same memo', async () => {
    const [first, second] = await Promise.all([computePublishedAgentReadiness(), computePublishedAgentReadiness()])
    expect(first).toBe(second)
    expect(mocks.gatherReadinessFacts).toHaveBeenCalledTimes(1)

    await computePublishedAgentReadiness({ now: new Date('2026-10-01T00:00:00Z') })
    expect(mocks.gatherReadinessFacts).toHaveBeenCalledTimes(2)
  })

  it('redacts unlisted pages from the published report even when options are passed', async () => {
    mocks.gatherReadinessFacts.mockResolvedValue({
      pages: [
        {
          pageId: 'drafts/secret', href: '/drafts/secret', title: 'Secret', description: '', keywords: [],
          hasContentDoc: true, headingsCount: 1, textLength: 500, codeBlocksCount: 0, inNav: false,
          isApi: false, hasOpenApiSpec: false, hasManualOperation: false, unlisted: true,
        },
      ],
      operations: null,
      retrieval: null,
    })
    for (const report of [
      (await getCachedPublishedAgentReadiness(9_000)).report,
      await computePublishedAgentReadiness({ redactUnlistedPages: false }),
    ]) {
      expect(JSON.stringify(report)).not.toContain('/drafts/secret')
      expect(report.subscores.find((sub) => sub.id === 'metadata')?.affectedCount).toBe(1)
    }
  })
})
