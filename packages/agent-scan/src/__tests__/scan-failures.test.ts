import { gzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { methodology } from '../methodology/methodology.js'
import { noopRateLimiter } from '../net/rate-limiter.js'
import { scanSite } from '../scan.js'
import type { SiteResult } from '../types.js'
import { createFakeTransport, docPage, html, notFound, text, type FakeRoutes, NEGOTIATE } from './helpers.js'
import { fixtureSite } from './fixture-site.js'

const quiet = { rateLimiter: noopRateLimiter(), sleep: async () => {}, now: () => new Date('2026-11-12T00:00:00Z') }
const scan = (url: string, routes: FakeRoutes) => scanSite(url, { transport: createFakeTransport(routes), ...quiet })
const check = (result: SiteResult, id: string) => result.checks.find((c) => c.id === id)!

function expectUnscanned(result: SiteResult, status: 'error' | 'skipped', reason: string) {
  expect(result.status).toBe(status)
  expect(result.reason).toBe(reason)
  expect(result.score).toBeNull()
  expect(result.grade).toBeNull()
  expect(result.checks).toHaveLength(methodology.checks.length)
  expect(result.checks.every((c) => c.status === 'not_applicable')).toBe(true)
  expect(result.categories.every((c) => !c.applicable)).toBe(true)
}

describe('site-level failures never throw (AC8)', () => {
  const origin = 'https://docs.example.com'

  it('invalid input URL -> error invalid_url', async () => {
    expectUnscanned(await scan('ftp://docs.example.com/', {}), 'error', 'invalid_url')
    expectUnscanned(await scan('not a url', {}), 'error', 'invalid_url')
  })

  it('private or loopback target -> skipped private_address', async () => {
    expectUnscanned(await scan('http://127.0.0.1/', {}), 'skipped', 'private_address')
    expectUnscanned(await scan('http://localhost/', {}), 'skipped', 'private_address')
  })

  it('robots.txt disallowing the scanner on the docs root -> skipped robots_disallowed (AC3)', async () => {
    const routes = fixtureSite({ robots: 'User-agent: ThallyAgentScan\nDisallow: /\n' })
    const transport = createFakeTransport(routes)
    const result = await scanSite(`${origin}/`, { transport, ...quiet })
    expectUnscanned(result, 'skipped', 'robots_disallowed')
    expect(result.checks[0].notApplicableReason).toBe('robots_disallowed')
    // Only robots.txt was requested; the disallowed root never was.
    expect(transport.requests.map((r) => r.url)).toEqual([`${origin}/robots.txt`])
  })

  it('robots.txt 5xx after retries -> skipped robots_unreachable', async () => {
    const transport = createFakeTransport({ [`${origin}/robots.txt`]: { status: 503, body: '' } })
    const result = await scanSite(`${origin}/`, { transport, ...quiet })
    expectUnscanned(result, 'skipped', 'robots_unreachable')
    expect(transport.requests).toHaveLength(3)
    expect(result.requests.used).toBe(3)
  })

  it('robots.txt timeout -> skipped robots_unreachable', async () => {
    expectUnscanned(await scan(`${origin}/`, { [`${origin}/robots.txt`]: { error: 'timeout' } }), 'skipped', 'robots_unreachable')
  })

  it('robots.txt 404 -> allow all and continue', async () => {
    const result = await scan(`${origin}/`, fixtureSite({ robots: notFound }))
    expect(result.status).toBe('ok')
    expect(check(result, 'discovery.robots_ai_agents').status).toBe('pass')
  })

  for (const error of ['dns', 'tls', 'connection', 'timeout'] as const) {
    it(`docs root ${error} -> error ${error}`, async () => {
      const routes: FakeRoutes = { [`${origin}/robots.txt`]: notFound, [`${origin}/`]: { error } }
      expectUnscanned(await scan(`${origin}/`, routes), 'error', error)
    })
  }

  it('docs root 4xx/5xx -> error http_status', async () => {
    expectUnscanned(await scan(`${origin}/`, { [`${origin}/robots.txt`]: notFound, [`${origin}/`]: { status: 403, body: 'denied' } }), 'error', 'http_status')
    expectUnscanned(await scan(`${origin}/`, { [`${origin}/robots.txt`]: notFound, [`${origin}/`]: { status: 404, body: '' } }), 'error', 'http_status')
  })

  it('non-HTML docs root -> error not_html', async () => {
    expectUnscanned(await scan(`${origin}/`, { [`${origin}/robots.txt`]: notFound, [`${origin}/`]: text('{}', 'application/json') }), 'error', 'not_html')
  })

  it('oversized docs root (over 5 MB decompressed) -> error body_too_large', async () => {
    const big = `<html><body>${'x'.repeat(methodology.limits.maxBodyBytes)}</body></html>`
    expectUnscanned(await scan(`${origin}/`, { [`${origin}/robots.txt`]: notFound, [`${origin}/`]: html(big) }), 'error', 'body_too_large')
  })

  it('docs root redirect loop -> error redirect_limit after 5 hops', async () => {
    const routes: FakeRoutes = { [`${origin}/robots.txt`]: notFound }
    for (let i = 0; i < 8; i++) routes[`${origin}/r${i}`] = { status: 302, headers: { location: `/r${i + 1}` } }
    expectUnscanned(await scan(`${origin}/r0`, routes), 'error', 'redirect_limit')
  })
})

describe('request plan behaviour', () => {
  const origin = 'https://docs.example.com'

  it('follows an offsite docs-root redirect and re-reads robots for the new origin', async () => {
    const routes = fixtureSite()
    routes['https://example.com/robots.txt'] = notFound
    routes['https://example.com/docs'] = { status: 301, headers: { location: `${origin}/` } }
    const transport = createFakeTransport(routes)
    const result = await scanSite('https://example.com/docs', { transport, ...quiet })
    expect(result.status).toBe('ok')
    expect(result.docsRoot).toBe(`${origin}/`)
    expect(transport.requests.slice(0, 4).map((r) => r.url)).toEqual([
      'https://example.com/robots.txt', 'https://example.com/docs', `${origin}/robots.txt`, `${origin}/`,
    ])
  })

  it('uses only GET with the scanner user agent, stays within 25 requests, and never re-requests a page', async () => {
    const transport = createFakeTransport(fixtureSite({ pageCount: 60 }))
    const result = await scanSite(`${origin}/`, { transport, ...quiet })
    expect(result.requests.used).toBeLessThanOrEqual(25)
    for (const req of transport.requests) {
      expect(req.method).toBe('GET')
      expect(req.headers['user-agent']).toBe(methodology.userAgent)
      expect(req.timeoutMs).toBe(10_000)
      expect(req.headers.cookie).toBeUndefined()
    }
  })

  it('drops tail sample pages first when redirects eat the budget, and reports it', async () => {
    const routes = fixtureSite({ pageCount: 30 })
    // Every sampled page redirects twice before answering: 3 requests per page.
    for (const path of ['/guide/page-00', '/guide/page-03', '/guide/page-06', '/guide/page-09', '/guide/page-12', '/guide/page-15', '/guide/page-18', '/guide/page-21', '/guide/page-24', '/guide/page-27']) {
      const final = routes[`${origin}${path}`]
      routes[`${origin}${path}`] = { status: 301, headers: { location: `${path}/x` } }
      routes[`${origin}${path}/x`] = { status: 301, headers: { location: `${path}/y` } }
      routes[`${origin}${path}/y`] = final
      routes[`${origin}${path}/y.md`] = text(`# Page ${path.slice(-2)}\n`, 'text/markdown')
    }
    const result = await scan(`${origin}/`, routes)
    expect(result.status).toBe('ok')
    expect(result.requests).toMatchObject({ used: 25, exhausted: true })
    expect(result.sample.droppedForBudget.length).toBeGreaterThan(0)
    expect(result.sample.droppedForBudget.at(-1)).toBe(`${origin}/guide/page-27`)
    const health = check(result, 'retrieval.status_health')
    expect(health.pages?.applicable).toBe(result.sample.pages.length)
    // Binary probes ran before the tail and still passed.
    expect(check(result, 'discovery.llms_txt').status).toBe('pass')
    expect(check(result, 'retrieval.alternate').status).toBe('pass')
  })

  it('marks binary probes not applicable (budget) when reached with the budget already exhausted', async () => {
    const routes: FakeRoutes = { [`${origin}/robots.txt`]: text(`Sitemap: ${origin}/a.xml\nSitemap: ${origin}/b.xml\n`) }
    routes[`${origin}/a.xml`] = { status: 503, body: '' }
    routes[`${origin}/b.xml`] = { status: 503, body: '' }
    // The docs root needs 5 redirect hops, then retries burn the rest.
    for (let i = 0; i < 5; i++) routes[`${origin}/r${i}`] = { status: 302, headers: { location: `/r${i + 1}` } }
    routes[`${origin}/r5`] = html(docPage({ url: `${origin}/r5`, title: 'Root' }))
    routes[`${origin}/llms.txt`] = { status: 503, body: '' }
    routes[`${origin}/llms-full.txt`] = { status: 503, body: '' }
    routes[`${origin}/sitemap.xml`] = { status: 503, body: '' }
    routes[`${origin}/.well-known/mcp.json`] = { status: 503, body: '' }
    routes[`${origin}/.well-known/mcp/server-card.json`] = { status: 503, body: '' }
    routes[`${origin}/.well-known/agent-card.json`] = { status: 503, body: '' }
    routes[`${origin}/r5.md`] = { status: 503, body: '' }
    routes[`${origin}/r5 ${NEGOTIATE}`] = { status: 503, body: '' }
    routes[`${origin}/r5?format=json`] = { status: 503, body: '' }
    const result = await scan(`${origin}/r0`, routes)
    expect(result.status).toBe('ok')
    expect(result.requests.exhausted).toBe(true)
    expect(check(result, 'retrieval.alternate')).toMatchObject({ status: 'not_applicable', notApplicableReason: 'budget' })
    expect(check(result, 'discovery.agent_manifest')).toMatchObject({ status: 'not_applicable', notApplicableReason: 'budget' })
    expect(result.score).not.toBeNull()
  })

  it('falls back to breadth-first links when there is no sitemap', async () => {
    const routes = fixtureSite({ sitemap: false, robots: 'User-agent: *\nAllow: /\n' })
    const result = await scan(`${origin}/`, routes)
    expect(result.sample.source).toBe('bfs')
    // Root links page-24, -23, -22 (document order), then nothing new from them.
    expect(result.sample.pages).toEqual([`${origin}/`, `${origin}/guide/page-24`, `${origin}/guide/page-23`, `${origin}/guide/page-22`])
    expect(check(result, 'discovery.sitemap').status).toBe('fail')
  })

  it('reports root_only when the root has no qualifying links', async () => {
    const routes = fixtureSite({ sitemap: false, robots: 'User-agent: *\nAllow: /\n' })
    routes[`${origin}/`] = html(docPage({ url: `${origin}/`, title: 'Home', links: ['https://elsewhere.test/a', '/file.pdf'] }))
    routes[`${origin}/.md`] = notFound
    routes[`${origin}/index.md`] = notFound
    routes[`${origin}/ ${NEGOTIATE}`] = html('<html></html>')
    routes[`${origin}/?format=json`] = notFound
    const result = await scan(`${origin}/`, routes)
    expect(result.sample).toMatchObject({ source: 'root_only', pages: [`${origin}/`] })
  })

  it('reads a gzipped sitemap index and prefers docs children', async () => {
    const routes = fixtureSite({ robots: `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap-index.xml.gz\n` })
    routes[`${origin}/sitemap-index.xml.gz`] = {
      status: 200,
      headers: { 'content-type': 'application/gzip' },
      body: gzipSync(`<sitemapindex><sitemap><loc>${origin}/blog.xml</loc></sitemap><sitemap><loc>${origin}/docs-pages.xml</loc></sitemap></sitemapindex>`),
    }
    routes[`${origin}/docs-pages.xml`] = { status: 200, headers: { 'content-type': 'text/xml' }, body: `<urlset>${Array.from({ length: 12 }, (_, i) => `<url><loc>${origin}/guide/page-${String(i).padStart(2, '0')}</loc></url>`).join('')}</urlset>` }
    const transport = createFakeTransport(routes)
    const result = await scanSite(`${origin}/`, { transport, ...quiet })
    expect(result.sample.source).toBe('sitemap')
    expect(result.sample.sitemapUrlCount).toBe(12)
    expect(transport.requests.map((r) => r.url)).not.toContain(`${origin}/blog.xml`)
  })

  it('excludes the site-wide llms.txt Link header from the alternate check', async () => {
    const routes = fixtureSite({ markdown: false })
    const page = routes[`${origin}/guide/page-00`] as { headers: Record<string, string> }
    page.headers = { ...page.headers, link: `</llms.txt>; rel="alternate"; type="text/markdown"` }
    const result = await scan(`${origin}/`, routes)
    expect(check(result, 'retrieval.alternate').status).toBe('fail')
    expect(check(result, 'parity.title')).toMatchObject({ status: 'not_applicable', notApplicableReason: 'no_alternate' })
  })

  it('accepts a content-negotiated Markdown response on the page URL', async () => {
    const routes = fixtureSite({ markdown: false })
    routes[`${origin}/guide/page-00 ${NEGOTIATE}`] = text('# Page 00\n\nBody', 'text/markdown')
    const accepted = await scan(`${origin}/`, routes)
    expect(check(accepted, 'retrieval.alternate')).toMatchObject({ status: 'pass', detail: 'Alternate markdown representation found (accept_negotiation).' })
    expect(check(accepted, 'parity.title').status).toBe('pass')
  })

  it('detects a Thally-hosted site and flags it', async () => {
    const routes = fixtureSite()
    routes[`${origin}/`] = html(docPage({ url: `${origin}/`, title: 'Home', head: '<script id="thally-runtime-name-shim">1</script>' }))
    const result = await scan(`${origin}/`, routes)
    expect(result.platform).toMatchObject({ platform: 'thally', confidence: 'high' })
    expect(result.thallyHosted).toBe(true)
  })
})
