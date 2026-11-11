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
import { createNodeTransport } from '../net/transport.js'
import { createFakeTransport, docPage, html, NEGOTIATE, notFound, text, type FakeRoutes } from './helpers.js'
import { fixturePaths, fixtureSite } from './fixture-site.js'
import { startFixtureServer } from './fixture-server.js'

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
    ['401 with WWW-Authenticate', { status: 401, headers: { 'content-type': 'text/html', 'www-authenticate': 'Bearer resource_metadata="https://docs.example.com/.well-known/oauth-protected-resource"' }, body: '<p>unauthorized</p>' }],
    ['200 plain text at /mcp', { status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' }],
  ])('passes on a plausible endpoint: %s', async (_, route) => {
    const { result } = await scanWith(site(route))
    expect(check(result, 'discovery.agent_manifest')).toMatchObject({ status: 'pass', detail: 'llms.txt links an MCP endpoint.' })
  })

  it('verifies an MCP URL on another host, fetching its robots.txt within the probe allocation', async () => {
    const routes = fixtureSite({ manifest: false })
    routes[`${origin}/llms.txt`] = text('# Docs\n\n- [MCP](https://mcp.other.test/sse)\n')
    routes['https://mcp.other.test/robots.txt'] = notFound
    routes['https://mcp.other.test/sse'] = { status: 405, headers: { 'content-type': 'application/json' }, body: '{}' }
    const { result, requested } = await scanWith(routes)
    expect(check(result, 'discovery.agent_manifest')).toMatchObject({ status: 'pass', evidence: [`${origin}/llms.txt`, 'https://mcp.other.test/sse'] })
    expect(requested.filter((url) => url.startsWith('https://mcp.other.test/'))).toEqual(['https://mcp.other.test/robots.txt', 'https://mcp.other.test/sse'])
    // A verified endpoint ends discovery; no well-known probes are needed.
    expect(requested.filter((url) => url.includes('/.well-known/'))).toEqual([])
  })

  it('keeps the site ok when the MCP host cannot be resolved, and says why the check failed', async () => {
    const routes = fixtureSite({ manifest: false })
    routes[`${origin}/llms.txt`] = text('# Docs\n\n- [MCP](https://mcp.other.test/sse)\n')
    routes['https://mcp.other.test/robots.txt'] = { error: 'dns' }
    const { result, requested } = await scanWith(routes)
    expect(result.status).toBe('ok')
    expect(check(result, 'discovery.agent_manifest')).toMatchObject({
      status: 'fail',
      detail: 'No agent or MCP manifest found; the MCP URL in llms.txt could not be fetched (dns).',
    })
    expect(requested).not.toContain('https://mcp.other.test/sse')
    // The other host's robots.txt and MCP URL took two of the three slots: one well-known probe is left.
    expect(requested.filter((url) => url.includes('/.well-known/'))).toEqual([`${origin}/.well-known/mcp.json`])
  })

  it('does not count a 401 without WWW-Authenticate', async () => {
    const { result } = await scanWith(site({ status: 401, headers: { 'content-type': 'text/html' }, body: '<p>sign in</p>' }))
    expect(check(result, 'discovery.agent_manifest')).toMatchObject({ status: 'fail', detail: 'No agent or MCP manifest found; the MCP URL in llms.txt is not an endpoint.' })
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
    expect(isPlausibleMcpEndpoint(at('https://mcp.example.test/sse', 401, 'application/json'))).toBe(false)
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

describe('sitemap for docs on a subpath', () => {
  it('finds the docs sitemap index under the docs root when the site-wide sitemap lists no docs', async () => {
    const site = 'https://brand.example.com'
    const www = 'https://www.brand.example.com'
    const docsPaths = Array.from({ length: 12 }, (_, i) => `/docs/guide/page-${String(i).padStart(2, '0')}`)
    const routes: FakeRoutes = {
      [`${site}/robots.txt`]: text(`User-agent: *\nAllow: /\nSitemap: ${www}/sitemap.xml\n`),
      [`${site}/docs/`]: html(docPage({ url: `${site}/docs/`, title: 'Docs home', links: docsPaths.slice(0, 3).map((path) => `${site}${path}`) })),
      // The site-wide marketing sitemap, reached directly and by redirect.
      [`${www}/robots.txt`]: notFound,
      [`${www}/sitemap.xml`]: { status: 200, headers: { 'content-type': 'application/xml' }, body: `<urlset><url><loc>${www}/pricing</loc></url><url><loc>${www}/blog/post</loc></url></urlset>` },
      [`${site}/sitemap.xml`]: { status: 301, headers: { location: `${www}/sitemap.xml` } },
      [`${site}/sitemap-index.xml`]: notFound,
      // The docs sitemap index and its page sitemap.
      [`${site}/docs/sitemap.xml`]: { status: 200, headers: { 'content-type': 'application/xml' }, body: `<sitemapindex><sitemap><loc>${site}/docs/sitemap-pages.xml</loc></sitemap></sitemapindex>` },
      [`${site}/docs/sitemap-pages.xml`]: { status: 200, headers: { 'content-type': 'application/xml' }, body: `<urlset>${docsPaths.map((path) => `<url><loc>${site}${path}</loc></url>`).join('')}</urlset>` },
      [`${site}/docs/llms.txt`]: notFound,
      [`${site}/llms.txt`]: notFound,
      [`${site}/llms-full.txt`]: notFound,
    }
    for (const path of ['/.well-known/mcp.json', '/.well-known/mcp/server-card.json', '/.well-known/agent-card.json']) routes[`${site}${path}`] = notFound
    for (const path of docsPaths) {
      routes[`${site}${path}`] = html(docPage({ url: `${site}${path}`, title: `Page ${path.slice(-2)}` }))
      routes[`${site}${path}.md`] = notFound
      routes[`${site}${path} ${NEGOTIATE}`] = notFound
      routes[`${site}${path}?format=json`] = notFound
    }
    const { result, requested } = await scanWith(routes, `${site}/docs/`)
    expect(result.status).toBe('ok')
    expect(check(result, 'discovery.sitemap')).toMatchObject({ status: 'pass', detail: 'Sitemap lists 12 URLs under the docs root.' })
    expect(result.sample.source).toBe('sitemap')
    expect(requested.filter((url) => url.includes('sitemap'))).toEqual([`${site}/docs/sitemap.xml`, `${site}/docs/sitemap-pages.xml`])
  })

  it('caps sitemap requests, including redirect hops, when robots.txt lists many redirecting sitemaps', async () => {
    const lines = Array.from({ length: 11 }, (_, i) => `Sitemap: ${origin}/maps/s${i}.xml`).join('\n')
    const routes = fixtureSite({ robots: `User-agent: *\nAllow: /\n${lines}\n` })
    const empty = { status: 200, headers: { 'content-type': 'application/xml' }, body: '<urlset></urlset>' }
    routes[`${origin}/maps/s0.xml`] = empty
    for (let i = 1; i < 11; i++) routes[`${origin}/maps/s${i}.xml`] = { status: 301, headers: { location: `${origin}/maps/s0.xml` } }
    const { result, requested } = await scanWith(routes)
    const sitemapRequests = requested.filter((url) => url.endsWith('.xml'))
    expect(sitemapRequests.length).toBeLessThanOrEqual(5)
    // s0 (slot 1), then s1 and s2 each redirecting to s0 (no slot, two requests each), then the cap.
    expect(sitemapRequests).toEqual([`${origin}/maps/s0.xml`, `${origin}/maps/s1.xml`, `${origin}/maps/s0.xml`, `${origin}/maps/s2.xml`, `${origin}/maps/s0.xml`])
    expect(result.status).toBe('ok')
    expect(result.requests.exhausted).toBe(false)
    expect(result.sample.source).toBe('bfs')
    expect(check(result, 'discovery.sitemap').status).toBe('fail')
  })
})

describe('docs on a subpath with a meta-refresh root (Astro-like)', () => {
  const stub = (to: string) => html(`<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${to}"></head><body></body></html>`)
  const xml = (body: string) => ({ status: 200, headers: { 'content-type': 'application/xml' }, body })

  function astroSite(): FakeRoutes {
    const enPaths = Array.from({ length: 12 }, (_, i) => `/en/guide/page-${String(i).padStart(2, '0')}`)
    const routes: FakeRoutes = {
      [`${origin}/robots.txt`]: text('User-agent: *\nAllow: /\n'),
      [`${origin}/en/`]: stub('/en/getting-started/'),
      [`${origin}/en/getting-started/`]: html(docPage({ url: `${origin}/en/getting-started/`, title: 'Getting started', links: enPaths.slice(0, 3).map((p) => `${origin}${p}`) })),
      [`${origin}/en/llms.txt`]: notFound,
      [`${origin}/llms.txt`]: notFound,
      [`${origin}/llms-full.txt`]: notFound,
      [`${origin}/en/sitemap.xml`]: notFound,
      [`${origin}/sitemap.xml`]: notFound,
      [`${origin}/sitemap-index.xml`]: xml(`<sitemapindex><sitemap><loc>${origin}/sitemap-0.xml</loc></sitemap></sitemapindex>`),
      [`${origin}/sitemap-0.xml`]: xml(`<urlset>${[...enPaths, '/en/getting-started/', '/de/guide/page-00'].map((p) => `<url><loc>${origin}${p}</loc></url>`).join('')}</urlset>`),
    }
    for (const path of ['/.well-known/mcp.json', '/.well-known/mcp/server-card.json', '/.well-known/agent-card.json']) routes[`${origin}${path}`] = notFound
    routes[`${origin}/en/getting-started/index.md`] = notFound
    routes[`${origin}/en/getting-started/ ${NEGOTIATE}`] = notFound
    routes[`${origin}/en/getting-started/?format=json`] = notFound
    for (const path of enPaths) {
      routes[`${origin}${path}`] = html(docPage({ url: `${origin}${path}`, title: `Page ${path.slice(-2)}` }))
      routes[`${origin}${path}.md`] = notFound
      routes[`${origin}${path} ${NEGOTIATE}`] = notFound
      routes[`${origin}${path}?format=json`] = notFound
    }
    return routes
  }

  it('does not spend sitemap slots on 404 candidates, so the index child is still fetched', async () => {
    const { result, requested } = await scanWith(astroSite(), `${origin}/en/`)
    expect(result.status).toBe('ok')
    expect(requested.filter((url) => url.includes('sitemap'))).toEqual([
      `${origin}/en/sitemap.xml`, `${origin}/sitemap.xml`, `${origin}/sitemap-index.xml`, `${origin}/sitemap-0.xml`,
    ])
    expect(check(result, 'discovery.sitemap')).toMatchObject({ status: 'pass', detail: 'Sitemap lists 13 URLs under the docs root.' })
    expect(result.sample.source).toBe('sitemap')
    // Root plus ten sampled pages; the stub's refresh hop may push a tail page out of the budget.
    expect(result.sample.pages.length + result.sample.droppedForBudget.length).toBe(11)
  })

  it('follows the root meta refresh, evaluates the target, and keeps the input docs root', async () => {
    const { result } = await scanWith(astroSite(), `${origin}/en/`)
    expect(result.docsRoot).toBe(`${origin}/en/`)
    expect(result.sample.metaRefreshes).toEqual([{ from: `${origin}/en/`, to: `${origin}/en/getting-started/` }])
    // The target is the root page, so it is not sampled a second time.
    expect(result.sample.pages.filter((url) => url === `${origin}/en/getting-started/`)).toEqual([])
    for (const id of ['identity.canonical', 'identity.lang', 'identity.title_description', 'structure.single_h1', 'retrieval.server_rendered', 'retrieval.status_health']) {
      expect(check(result, id).status, id).toBe('pass')
    }
  })

  it('does not follow an offsite meta refresh', async () => {
    const routes = astroSite()
    routes[`${origin}/en/`] = stub('https://elsewhere.test/en/')
    const { result, requested } = await scanWith(routes, `${origin}/en/`)
    expect(requested.some((url) => url.startsWith('https://elsewhere.test/'))).toBe(false)
    expect(result.sample.metaRefreshes).toEqual([])
    expect(check(result, 'identity.title_description').status).toBe('fail')
  })

  it('follows an immediate meta refresh on a sampled page but not a delayed one', async () => {
    const routes = astroSite()
    routes[`${origin}/en/guide/page-00`] = stub('/en/guide/page-00/moved')
    routes[`${origin}/en/guide/page-00/moved`] = html(docPage({ url: `${origin}/en/guide/page-00/moved`, title: 'Page 00' }))
    routes[`${origin}/en/guide/page-00/moved.md`] = notFound
    routes[`${origin}/en/guide/page-00/moved ${NEGOTIATE}`] = notFound
    routes[`${origin}/en/guide/page-00/moved?format=json`] = notFound
    routes[`${origin}/en/guide/page-01`] = html('<html><head><meta http-equiv="refresh" content="5; url=/en/guide/page-02"></head><body></body></html>')
    const { result } = await scanWith(routes, `${origin}/en/`)
    expect(result.sample.metaRefreshes).toContainEqual({ from: `${origin}/en/guide/page-00`, to: `${origin}/en/guide/page-00/moved` })
    expect(result.sample.metaRefreshes.some((entry) => entry.from === `${origin}/en/guide/page-01`)).toBe(false)
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

describe('MCP endpoint over a live event stream', () => {
  it('passes on an open text/event-stream response with one request, without waiting for the stream to end', async () => {
    const server = await startFixtureServer((base) => {
      const routes = fixtureSite({ origin: base, manifest: false })
      routes[`${base}/mcp`] = { status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'event: ping\ndata: x\n\n', hold: true }
      return routes
    })
    try {
      const inner = createNodeTransport({ allowPrivateNetwork: true })
      const seen: string[] = []
      const transport = { request: (request: Parameters<typeof inner.request>[0]) => (seen.push(request.url), inner.request(request)) }
      const started = Date.now()
      const result = await scanSite(`${server.origin}/`, { transport, allowPrivateNetwork: true, ...quiet })
      expect(Date.now() - started).toBeLessThan(5000)
      expect(seen.filter((url) => url === `${server.origin}/mcp`)).toHaveLength(1)
      expect(check(result, 'discovery.agent_manifest')).toMatchObject({ status: 'pass', detail: 'llms.txt links an MCP endpoint.' })
    } finally {
      await server.close()
    }
  })
})
