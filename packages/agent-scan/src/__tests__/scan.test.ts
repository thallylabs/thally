import { describe, expect, it } from 'vitest'

import { noopRateLimiter } from '../net/rate-limiter.js'
import { scanSite } from '../scan.js'
import { stableStringify } from '../output/stable-json.js'
import { createFakeTransport } from './helpers.js'
import { fixtureSite } from './fixture-site.js'

const fixedNow = () => new Date('2026-11-12T00:00:00.000Z')
const quiet = { rateLimiter: noopRateLimiter(), sleep: async () => {}, now: fixedNow }

describe('scanSite on a synthetic site (AC1)', () => {
  it('returns a typed, fully passing result', async () => {
    const transport = createFakeTransport(fixtureSite())
    const result = await scanSite('https://docs.example.com/', { transport, ...quiet })
    expect(result.status).toBe('ok')
    expect(result.docsRoot).toBe('https://docs.example.com/')
    expect(result.methodology).toEqual({ id: 'thally-agent-scan', version: '1.0' })
    expect(result.sample.source).toBe('sitemap')
    expect(result.sample.pages).toHaveLength(11)
    expect(result.checks).toHaveLength(19)
    const failing = result.checks.filter((check) => check.status !== 'pass')
    expect(failing.map((check) => [check.id, check.detail])).toEqual([])
    expect(result.score).toBe(100)
    expect(result.grade).toBe('A')
    expect(result.platform).toEqual({ platform: 'docusaurus', confidence: 'high', signals: ['meta:generator=Docusaurus v3.5.2'] })
    expect(result.thallyHosted).toBe(false)
    expect(result.requests.used).toBeLessThanOrEqual(25)
    for (const check of result.checks) expect(check.evidence.length).toBeGreaterThan(0)
    expect(stableStringify(result)).toBe(stableStringify(await scanSite('https://docs.example.com/', { transport: createFakeTransport(fixtureSite()), ...quiet })))
  })
})
