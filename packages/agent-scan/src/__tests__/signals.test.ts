/**
 * Behaviour of the signal checks on real-world page shapes: JSON-LD node
 * selection, alternate representations (feeds, other hosts, content
 * negotiation), MCP endpoint plausibility, sitemap fallbacks and robots.txt
 * connection failures. Everything runs through the fake transport.
 */

import { describe, expect, it } from 'vitest'

import { evaluators } from '../checks/index.js'
import { isPlausibleMcpEndpoint } from '../checks/discovery.js'
import type { SiteFacts } from '../facts.js'
import { isFeedUrl } from '../gather.js'
import { parsePage } from '../html.js'
import { selectPageNode, topLevelNodes } from '../jsonld.js'
import { noopRateLimiter } from '../net/rate-limiter.js'
import { allowAllRobots } from '../robots.js'
import { scanSite } from '../scan.js'
import { jsonTitle } from '../text.js'
import type { FetchOutcome, SiteResult } from '../types.js'
import { isSameSite } from '../url.js'
import { createFakeTransport, docPage, html, NEGOTIATE, notFound, text, type FakeRoutes } from './helpers.js'
import { fixturePaths, fixtureSite } from './fixture-site.js'

const origin = 'https://docs.example.com'
const probe = `${origin}/guide/page-00`
const quiet = { rateLimiter: noopRateLimiter(), sleep: async () => {}, now: () => new Date('2026-11-12T00:00:00Z') }
const scanWith = async (routes: FakeRoutes, url = `${origin}/`) => {
  const transport = createFakeTransport(routes)
  const result = await scanSite(url, { transport, ...quiet })
  return { result, requested: transport.requests.map((request) => request.url) }
}
const check = (result: SiteResult, id: string) => result.checks.find((c) => c.id === id)!

/** A page whose JSON-LD carries a site node that claims the page URL next to the article node. */
function graphPage(url: string, title: string, options: { articleDate?: boolean } = {}): string {
  return docPage({
    url,
    title,
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', '@id': `${origin}/#website`, url, name: 'Example Docs', description: 'Site-wide description', dateModified: '2026-02-02' },
        { '@type': 'Organization', name: 'Example' },
        {
          '@type': 'TechArticle', headline: title, description: `${title} description`,
          ...(options.articleDate === false ? {} : { dateModified: '2026-01-01' }),
        },
      ],
    },
  })
}

describe('JSON-LD page node selection', () => {
  it('uses the article node, not a site node that shares the page URL, for parity.description and dates', async () => {
    const routes = fixtureSite()
    for (const path of [...fixturePaths(25), '/']) {
      routes[`${origin}${path}`] = html(graphPage(`${origin}${path}`, path === '/' ? 'Home' : `Page ${path.slice(-2)}`))
    }
    const { result } = await scanWith(routes)
    expect(check(result, 'parity.description').status).toBe('pass')
    expect(check(result, 'identity.dates').status).toBe('pass')
  })

  it('does not credit a dateModified that only the site node carries', () => {
    const page = parsePage(graphPage(probe, 'Page 00', { articleDate: false }), probe)
    expect(page.jsonLd.description).toBe('Page 00 description')
    expect(page.jsonLd.hasDateModified).toBe(false)
  })

  it('prefers a page-type node whose url or @id is the page, then the most specific page type, then any node', () => {
    const webPage = { '@type': 'WebPage', url: `${probe}#main`, description: 'web page' }
    const article = { '@type': 'TechArticle', url: `${origin}/other`, description: 'article' }
    const site = { '@type': 'WebSite', url: probe, description: 'site' }
    expect(selectPageNode([site, article, webPage], probe)?.description).toBe('web page')
    expect(selectPageNode([site, webPage, { ...article, url: undefined }], `${origin}/x`)?.description).toBe('article')
    expect(selectPageNode([site, { '@type': 'Organization' }], probe)?.description).toBe('site')
    expect(selectPageNode([], probe)).toBeNull()
  })

  it('reads a JSON-LD shaped JSON alternate title from the page node', () => {
    const doc = { '@graph': [{ '@type': 'WebSite', name: 'Example Docs' }, { '@type': 'TechArticle', headline: 'Install' }] }
    expect(jsonTitle(doc, probe)).toBe('Install')
    expect(topLevelNodes(doc)).toHaveLength(2)
    expect(jsonTitle({ title: 'Plain' })).toBe('Plain')
  })

  it('reports an accurate detail when no page has both descriptions', async () => {
    const routes = fixtureSite()
    for (const path of [...fixturePaths(25), '/']) {
      const url = `${origin}${path}`
      routes[url] = html(docPage({ url, title: 'T', jsonLd: { '@context': 'https://schema.org', '@type': 'TechArticle', headline: 'T', dateModified: '2026-01-01' } }))
    }
    const { result } = await scanWith(routes)
    expect(check(result, 'parity.description')).toMatchObject({
      status: 'not_applicable',
      notApplicableReason: 'no_comparable_pages',
      detail: 'No sampled page has both a meta description and a JSON-LD description.',
    })
  })
})

describe('retrieval.alternate', () => {
  const pageWithHead = (head: string) => html(docPage({ url: probe, title: 'Page 00', head }))

  it('never accepts a feed: a declared feed.json link is not fetched', async () => {
    const routes = fixtureSite({ markdown: false })
    routes[probe] = pageWithHead(`<link rel="alternate" type="application/json" href="/feed.json">`)
    routes[`${origin}/feed.json`] = text('{"version":"https://jsonfeed.org/version/1.1","title":"Page 00"}', 'application/json')
    const { result, requested } = await scanWith(routes)
    expect(check(result, 'retrieval.alternate').status).toBe('fail')
    expect(requested).not.toContain(`${origin}/feed.json`)
  })

  it('rejects an application/feed+json response', async () => {
    const routes = fixtureSite({ markdown: false })
    routes[`${probe}?format=json`] = text('{"title":"Page 00","items":[]}', 'application/feed+json')
    const { result } = await scanWith(routes)
    expect(check(result, 'retrieval.alternate').status).toBe('fail')
  })

  it('flags feed URLs by path', () => {
    expect(isFeedUrl(`${origin}/blog/feed.json`)).toBe(true)
    expect(isFeedUrl(`${origin}/blog/feed/`)).toBe(true)
    expect(isFeedUrl(`${origin}/guide/feeding.md`)).toBe(false)
  })

  it('does not fetch a declared alternate on another host and fails with a detail naming it', async () => {
    const routes = fixtureSite({ markdown: false })
    routes[probe] = pageWithHead(`<link rel="alternate" type="text/markdown" href="https://cdn.other.test/page-00.md">`)
    const { result, requested } = await scanWith(routes)
    const alternate = check(result, 'retrieval.alternate')
    expect(alternate.status).toBe('fail')
    expect(alternate.detail).toContain('https://cdn.other.test/page-00.md')
    expect(alternate.evidence).toContain('https://cdn.other.test/page-00.md')
    expect(requested.some((url) => url.startsWith('https://cdn.other.test/'))).toBe(false)
  })

  it('accepts a declared same-site Markdown alternate', async () => {
    const routes = fixtureSite({ markdown: false })
    routes[probe] = pageWithHead(`<link rel="alternate" type="text/markdown" href="/raw/page-00.md">`)
    routes[`${origin}/raw/page-00.md`] = text('# Page 00\n\nBody', 'text/markdown')
    const { result } = await scanWith(routes)
    expect(check(result, 'retrieval.alternate')).toMatchObject({ status: 'pass', detail: 'Alternate markdown representation found (link_alternate).' })
  })

  it('counts plain content negotiation that returns JSON', async () => {
    const routes = fixtureSite({ markdown: false })
    routes[`${probe} ${NEGOTIATE}`] = text('{"title":"Page 00","body":"..."}', 'application/json')
    const { result } = await scanWith(routes)
    expect(check(result, 'retrieval.alternate')).toMatchObject({ status: 'pass', detail: 'Alternate json representation found (accept_negotiation).' })
    expect(check(result, 'parity.title').status).toBe('pass')
  })

  it('does not count text/plain from content negotiation', async () => {
    const routes = fixtureSite({ markdown: false })
    routes[`${probe} ${NEGOTIATE}`] = text('Page 00\n\nBody')
    const { result } = await scanWith(routes)
    expect(check(result, 'retrieval.alternate').status).toBe('fail')
  })
})

describe('discovery.agent_manifest and MCP URLs from llms.txt', () => {
  const site = (mcp: FakeRoutes[string]) => {
    const routes = fixtureSite({ manifest: false })
    routes[`${origin}/mcp`] = mcp
    return routes
  }

  it('fails when the MCP URL is a documentation page (200 HTML)', async () => {
    const { result, requested } = await scanWith(site(html(docPage({ url: `${origin}/mcp`, title: 'Our MCP server' }))))
    const manifest = check(result, 'discovery.agent_manifest')
    expect(manifest.status).toBe('fail')
    expect(manifest.detail).toContain('not an endpoint')
    // The MCP URL took one of the three probe slots.
    expect(requested.filter((url) => url.includes('/.well-known/'))).toEqual([`${origin}/.well-known/mcp.json`, `${origin}/.well-known/mcp/server-card.json`])
  })

  it.each([
    ['405 JSON', { status: 405, headers: { 'content-type': 'application/json' }, body: '{}' }],
    ['400 HTML', { status: 400, headers: { 'content-type': 'text/html' }, body: '<p>bad request</p>' }],
    ['200 event stream', { status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'event: endpoint\n\n' }],
    ['200 plain text at /mcp', { status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' }],
  ])('passes on a plausible endpoint: %s', async (_, route) => {
    const { result } = await scanWith(site(route))
    expect(check(result, 'discovery.agent_manifest')).toMatchObject({ status: 'pass', detail: 'llms.txt links an MCP endpoint.' })
  })

  it('judges endpoint plausibility from status, media type and path', () => {
    const at = (url: string, status: number, contentType: string | null): FetchOutcome => ({
      requestedUrl: url, finalUrl: url, status, error: null, redirects: 0, contentType, headers: [],
      text: '', body: new Uint8Array(), bodySha256: 'x', bytes: 0, truncated: false,
    })
    expect(isPlausibleMcpEndpoint(at('https://mcp.example.test/sse', 200, 'text/html'))).toBe(false)
    expect(isPlausibleMcpEndpoint(at('https://x.test/docs/mcp', 200, 'text/html'))).toBe(false)
    expect(isPlausibleMcpEndpoint(at('https://x.test/api/mcp', 200, 'text/plain'))).toBe(true)
    expect(isPlausibleMcpEndpoint(at('https://x.test/docs/mcp-guide', 200, 'text/plain'))).toBe(false)
    expect(isPlausibleMcpEndpoint(at('https://mcp.example.test/sse', 406, 'text/plain'))).toBe(true)
    expect(isPlausibleMcpEndpoint(at('https://mcp.example.test/', 200, 'application/json'))).toBe(true)
    expect(isPlausibleMcpEndpoint(at('https://x.test/mcp', 404, 'application/json'))).toBe(false)
  })

  it('is not applicable (budget) when the MCP check was skipped for budget', () => {
    const llms = { requestedUrl: `${origin}/llms.txt`, finalUrl: `${origin}/llms.txt`, status: 200, error: null, redirects: 0, contentType: 'text/plain', headers: [], text: `- [MCP](${origin}/mcp)`, body: new Uint8Array(), bodySha256: 'x', bytes: 1, truncated: false } satisfies FetchOutcome
    const facts: SiteFacts = {
      docsRoot: `${origin}/`,
      robots: { rules: allowAllRobots(), found: false },
      pages: [],
      llms: { attempts: [llms], hit: llms, skippedForBudget: false },
      llmsFull: { attempts: [], hit: null, skippedForBudget: false },
      sitemap: { attempts: [], parsed: [], locsUnderRoot: 0, skippedForBudget: false },
      wellKnown: { attempts: [], hit: null, skippedForBudget: false },
      rootLinkHeaderMcp: false,
      mcpEndpoint: { url: `${origin}/mcp`, outcome: null, isEndpoint: false, skippedForBudget: true },
      alternate: { probePage: probe, attempts: [], hit: null, title: null },
    }
    expect(evaluators['discovery.agent_manifest'](facts)).toMatchObject({ status: 'not_applicable', notApplicableReason: 'budget' })
  })
})

describe('sitemap candidates', () => {
  it('falls back to /sitemap-index.xml when robots.txt names none and /sitemap.xml is missing', async () => {
    const routes = fixtureSite({ robots: 'User-agent: *\nAllow: /\n' })
    routes[`${origin}/sitemap-index.xml`] = routes[`${origin}/sitemap.xml`]
    routes[`${origin}/sitemap.xml`] = notFound
    const { result, requested } = await scanWith(routes)
    expect(result.sample.source).toBe('sitemap')
    expect(check(result, 'discovery.sitemap').status).toBe('pass')
    expect(requested.filter((url) => url.includes('sitemap'))).toEqual([`${origin}/sitemap.xml`, `${origin}/sitemap-index.xml`])
  })

  it('tries robots.txt Sitemap lines before the fixed paths', async () => {
    const routes = fixtureSite({ robots: `User-agent: *\nAllow: /\nSitemap: ${origin}/maps/docs.xml\n` })
    routes[`${origin}/maps/docs.xml`] = notFound
    const { requested } = await scanWith(routes)
    expect(requested.filter((url) => url.includes('.xml'))).toEqual([`${origin}/maps/docs.xml`, `${origin}/sitemap.xml`])
  })
})

describe('robots.txt connection failures', () => {
  it.each(['connection', 'dns', 'tls'] as const)('robots.txt %s -> error with that reason', async (error) => {
    const { result } = await scanWith({ [`${origin}/robots.txt`]: { error } })
    expect(result).toMatchObject({ status: 'error', reason: error, score: null })
  })

  it('robots.txt timeout and 5xx stay skipped robots_unreachable', async () => {
    expect((await scanWith({ [`${origin}/robots.txt`]: { error: 'timeout' } })).result).toMatchObject({ status: 'skipped', reason: 'robots_unreachable' })
    expect((await scanWith({ [`${origin}/robots.txt`]: { status: 502, body: '' } })).result).toMatchObject({ status: 'skipped', reason: 'robots_unreachable' })
  })
})

describe('isSameSite', () => {
  it('allows only the same host apart from www, the same port, and http to https', () => {
    expect(isSameSite('https://docs.example.com/', 'https://docs.example.com/a')).toBe(true)
    expect(isSameSite('https://example.com/', 'https://www.example.com/a')).toBe(true)
    expect(isSameSite('http://docs.example.com/', 'https://docs.example.com/a')).toBe(true)
    expect(isSameSite('https://docs.example.com/', 'http://docs.example.com/a')).toBe(false)
    expect(isSameSite('https://docs.example.com/', 'https://docs.example.com:8443/a')).toBe(false)
    expect(isSameSite('http://127.0.0.1:8080/', 'http://127.0.0.1:9090/a')).toBe(false)
    expect(isSameSite('https://docs.example.com/', 'https://api.example.com/a')).toBe(false)
  })
})
