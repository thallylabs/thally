import { describe, expect, it } from 'vitest'

import { createFetcher } from '../net/fetcher.js'
import { createRateLimiter, noopRateLimiter } from '../net/rate-limiter.js'
import { createFakeTransport, notFound, text, type FakeRoutes } from './helpers.js'

function fetcherFor(routes: FakeRoutes, sleeps: number[] = [], budget?: number) {
  const transport = createFakeTransport(routes)
  const fetcher = createFetcher({
    transport,
    rateLimiter: noopRateLimiter(),
    allowPrivateNetwork: false,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    ...(budget ? { budget } : {}),
  })
  return { fetcher, transport }
}

const O = 'https://docs.example.com'

describe('fetcher politeness (AC3)', () => {
  it('retries 5xx twice with 1 s then 2 s backoff, counting every attempt', async () => {
    const sleeps: number[] = []
    const { fetcher, transport } = fetcherFor({ [`${O}/robots.txt`]: notFound, [`${O}/a`]: [{ status: 503 }, { status: 502 }, text('ok')] }, sleeps)
    const outcome = await fetcher.get(`${O}/a`, { purpose: 'html' })
    expect(outcome.status).toBe(200)
    expect(sleeps).toEqual([1000, 2000])
    expect(transport.requests).toHaveLength(4)
    expect(fetcher.used).toBe(4)
  })

  it('gives up after 2 retries and returns the last response', async () => {
    const { fetcher } = fetcherFor({ [`${O}/robots.txt`]: notFound, [`${O}/a`]: { status: 500 } })
    const outcome = await fetcher.get(`${O}/a`, { purpose: 'html' })
    expect(outcome.status).toBe(500)
    expect(fetcher.used).toBe(4)
  })

  it('honours a short Retry-After and does not retry on a long one', async () => {
    const sleeps: number[] = []
    const short = fetcherFor({ [`${O}/robots.txt`]: notFound, [`${O}/a`]: [{ status: 429, headers: { 'retry-after': '3' } }, text('ok')] }, sleeps)
    expect((await short.fetcher.get(`${O}/a`, { purpose: 'html' })).status).toBe(200)
    expect(sleeps).toEqual([3000])
    const long = fetcherFor({ [`${O}/robots.txt`]: notFound, [`${O}/a`]: [{ status: 429, headers: { 'retry-after': '60' } }, text('ok')] })
    expect((await long.fetcher.get(`${O}/a`, { purpose: 'html' })).status).toBe(429)
  })

  it('retries timeouts but not DNS failures or 4xx', async () => {
    const { fetcher, transport } = fetcherFor({
      [`${O}/robots.txt`]: notFound,
      [`${O}/t`]: [{ error: 'timeout' }, text('ok')],
      [`${O}/d`]: { error: 'dns' },
      [`${O}/n`]: { status: 404 },
    })
    expect((await fetcher.get(`${O}/t`, { purpose: 'html' })).status).toBe(200)
    expect((await fetcher.get(`${O}/d`, { purpose: 'html' })).error).toBe('dns')
    expect((await fetcher.get(`${O}/n`, { purpose: 'html' })).status).toBe(404)
    expect(transport.requests.filter((r) => r.url === `${O}/d`)).toHaveLength(1)
    expect(transport.requests.filter((r) => r.url === `${O}/n`)).toHaveLength(1)
  })

  it('gates every redirect hop on robots and refuses offsite page redirects', async () => {
    const { fetcher } = fetcherFor({
      [`${O}/robots.txt`]: text('User-agent: *\nDisallow: /private\n'),
      [`${O}/a`]: { status: 302, headers: { location: '/private/x' } },
      [`${O}/b`]: { status: 302, headers: { location: 'https://other.test/x' } },
      [`${O}/c`]: { status: 301, headers: { location: 'https://www.docs.example.com/c' } },
      'https://www.docs.example.com/robots.txt': notFound,
      'https://www.docs.example.com/c': text('ok'),
    })
    expect((await fetcher.get(`${O}/a`, { purpose: 'html' })).error).toBe('robots_disallowed')
    expect(await fetcher.get(`${O}/b`, { purpose: 'html' })).toMatchObject({ error: 'redirect_offsite', finalUrl: 'https://other.test/x' })
    expect(await fetcher.get(`${O}/c`, { purpose: 'html' })).toMatchObject({ status: 200, redirects: 1 })
  })

  it('stops at the request budget without touching the network', async () => {
    const { fetcher, transport } = fetcherFor({ [`${O}/robots.txt`]: notFound, [`${O}/a`]: text('ok') }, [], 2)
    await fetcher.get(`${O}/a`, { purpose: 'html' })
    const outcome = await fetcher.get(`${O}/a`, { purpose: 'html' })
    expect(outcome.error).toBe('budget_exhausted')
    expect(transport.requests).toHaveLength(2)
    expect(fetcher.exhausted).toBe(true)
  })

  it('follows robots.txt redirects across hosts (RFC 9309) without gating them', async () => {
    const { fetcher } = fetcherFor({
      [`${O}/robots.txt`]: { status: 301, headers: { location: 'https://cdn.example.net/robots.txt' } },
      'https://cdn.example.net/robots.txt': text('User-agent: *\nDisallow: /x\n'),
    })
    const robots = await fetcher.robotsFor(O)
    expect(robots.kind).toBe('ok')
    expect(robots.rules.isAllowed('ThallyAgentScan', '/x')).toBe(false)
  })
})

describe('per-host rate limiter', () => {
  it('spaces request starts to the same host by the interval and leaves other hosts alone', async () => {
    let clock = 0
    const waits: number[] = []
    const limiter = createRateLimiter({
      minIntervalMs: 1000,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms)
      },
    })
    await Promise.all([limiter.acquire('a.test'), limiter.acquire('a.test'), limiter.acquire('A.test'), limiter.acquire('b.test')])
    expect(waits).toEqual([1000, 2000])
    clock = 5000
    await limiter.acquire('a.test')
    expect(waits).toEqual([1000, 2000])
  })
})
