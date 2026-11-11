import { describe, expect, it } from 'vitest'

import { isValidLlmsFull } from '../checks/discovery.js'
import { evaluators } from '../checks/index.js'
import type { AlternateAttempt, PageRecord, SiteFacts } from '../facts.js'
import { parsePage } from '../html.js'
import { allowAllRobots, parseRobots } from '../robots.js'
import type { FetchOutcome } from '../types.js'
import { docPage } from './helpers.js'

const ROOT = 'https://x.test/'

function outcome(url: string, extra: Partial<FetchOutcome> = {}): FetchOutcome {
  const text = extra.text ?? ''
  return {
    requestedUrl: url, finalUrl: url, status: 200, error: null, redirects: 0, contentType: 'text/html', headers: [],
    text, body: new TextEncoder().encode(text), bodySha256: 'x', bytes: new TextEncoder().encode(text).byteLength, truncated: false, ...extra,
  }
}

function page(url: string, html: string | null, extra: Partial<FetchOutcome> = {}): PageRecord {
  return { url, isRoot: url === ROOT, outcome: outcome(url, { text: html ?? '', ...extra }), html: html === null ? null : parsePage(html, url) }
}

const emptyProbe = { attempts: [], hit: null, skippedForBudget: false }

function facts(pages: PageRecord[], overrides: Partial<SiteFacts> = {}): SiteFacts {
  return {
    docsRoot: ROOT,
    robots: { rules: allowAllRobots(), found: false },
    pages,
    llms: emptyProbe,
    llmsFull: emptyProbe,
    sitemap: { attempts: [], parsed: [], locsUnderRoot: 0, skippedForBudget: false },
    wellKnown: emptyProbe,
    rootLinkHeaderMcp: false,
    mcpEndpoint: { url: null, outcome: null, isEndpoint: false, skippedForBudget: false },
    alternate: { probePage: pages[0]?.url ?? ROOT, attempts: [], hit: null, title: null },
    ...overrides,
  }
}

const good = (url: string) => page(url, docPage({ url, title: 'Install' }))
const run = (id: string, f: SiteFacts) => evaluators[id](f)

describe('page-rate checks: pass, fail and not applicable (AC9)', () => {
  const cases: Array<[string, string]> = [
    ['identity.canonical', '<html lang="en"><head><link rel="canonical" href="https://x.test/other"></head><body></body></html>'],
    ['identity.lang', '<html><body></body></html>'],
    ['identity.title_description', '<html lang="en"><head><title>T</title></head><body></body></html>'],
    ['identity.dates', '<html><body><time>2026-01-01</time></body></html>'],
    ['structure.single_h1', '<html><body><h1>a</h1><h1>b</h1></body></html>'],
    ['structure.heading_order', '<html><body><main><h1>a</h1><h3>c</h3></main></body></html>'],
    ['structure.json_ld', '<html><body><script type="application/ld+json">{"name":"no type"}</script></body></html>'],
    ['retrieval.server_rendered', '<html><body><div id="root"></div><script>render()</script></body></html>'],
    ['trust.ownership', '<html><body><footer>No owner here</footer></body></html>'],
    ['trust.correction_path', '<html><body><a href="https://github.com/o/r">repo</a></body></html>'],
  ]
  for (const [id, failing] of cases) {
    it(id, () => {
      const pass = run(id, facts([good(ROOT), good('https://x.test/a')]))
      expect(pass).toMatchObject({ status: 'pass', value: 1, pages: { passed: 2, applicable: 2 } })
      const mixed = run(id, facts([good(ROOT), page('https://x.test/bad', failing)]))
      expect(mixed).toMatchObject({ status: 'fail', value: 0.5, pages: { passed: 1, applicable: 2 } })
      expect(mixed.evidence[0]).toBe('https://x.test/bad')
      const none = run(id, facts([page(ROOT, null, { contentType: 'application/pdf' })]))
      expect(none).toMatchObject({ status: 'not_applicable', value: null, notApplicableReason: 'no_html_pages' })
    })
  }

  it('canonical accepts a trailing-slash variant and rejects two canonicals', () => {
    const slash = page('https://x.test/a', '<html><head><link rel="canonical" href="/a/"></head></html>')
    expect(run('identity.canonical', facts([slash])).value).toBe(1)
    const two = page('https://x.test/a', '<html><head><link rel="canonical" href="/a"><link rel="canonical" href="/a"></head></html>')
    expect(run('identity.canonical', facts([two])).value).toBe(0)
  })

  it('dates accept a visible "last updated" time, article meta, or JSON-LD @graph dateModified', () => {
    const visible = page(ROOT, '<html><body><p>Last updated <time datetime="2026-01-01">Jan 1</time></p></body></html>')
    const meta = page('https://x.test/m', '<html><head><meta property="article:modified_time" content="2026-01-01"></head></html>')
    const graph = page('https://x.test/g', '<html><head><script type="application/ld+json">{"@graph":[{"@type":"WebPage","dateModified":"2026"}]}</script></head></html>')
    expect(run('identity.dates', facts([visible, meta, graph])).value).toBe(1)
  })

  it('heading order ignores sidebar headings outside main and allows upward jumps', () => {
    const html = '<html><body><nav><h5>Menu</h5></nav><main><h2>A</h2><h3>B</h3><h2>C</h2><h3>D</h3><h4>E</h4><h2>F</h2></main></body></html>'
    expect(run('structure.heading_order', facts([page(ROOT, html)])).value).toBe(1)
  })

  it('JSON-LD fails when any script is unparseable', () => {
    const html = '<html><head><script type="application/ld+json">{"@type":"WebPage"}</script><script type="application/ld+json">{oops</script></head></html>'
    expect(run('structure.json_ld', facts([page(ROOT, html)])).value).toBe(0)
  })

  it('server-rendered text falls back to the body without chrome', () => {
    const text = 'Readable content. '.repeat(15)
    const html = `<html><body><header>${'x'.repeat(300)}</header><div>${text}</div></body></html>`
    expect(run('retrieval.server_rendered', facts([page(ROOT, html)])).value).toBe(1)
    const chromeOnly = `<html><body><header>${'x'.repeat(300)}</header><nav>${'y'.repeat(300)}</nav><div>short</div></body></html>`
    expect(run('retrieval.server_rendered', facts([page(ROOT, chromeOnly)])).value).toBe(0)
  })

  it('ownership accepts an Organization publisher or a copyright footer with a link', () => {
    const footer = page(ROOT, '<html><body><footer>Copyright 2026 <a href="/">Acme</a></footer></body></html>')
    const ld = page('https://x.test/a', '<html><head><script type="application/ld+json">{"@type":"Article","publisher":{"@type":"Organization","name":"Acme"}}</script></head></html>')
    expect(run('trust.ownership', facts([footer, ld])).value).toBe(1)
  })

  it('correction path accepts forge edit links or feedback text', () => {
    const gitlab = page(ROOT, '<html><body><a href="https://gitlab.com/g/p/-/edit/main/x.md">x</a></body></html>')
    const feedback = page('https://x.test/a', '<html><body><p>Was this page helpful?</p></body></html>')
    expect(run('trust.correction_path', facts([gitlab, feedback])).value).toBe(1)
  })
})

describe('status health', () => {
  it('fails errors, non-200 and long redirect chains; passes up to 2 redirects', () => {
    const pages = [
      page(ROOT, '<html></html>'),
      page('https://x.test/r2', '<html></html>', { redirects: 2 }),
      page('https://x.test/r3', '<html></html>', { redirects: 3 }),
      page('https://x.test/404', null, { status: 404 }),
      page('https://x.test/off', null, { status: null, error: 'redirect_offsite' }),
    ]
    expect(run('retrieval.status_health', facts(pages))).toMatchObject({ value: 0.4, pages: { passed: 2, applicable: 5 } })
  })

  it('is not applicable when no page was attempted', () => {
    expect(run('retrieval.status_health', facts([]))).toMatchObject({ status: 'not_applicable', notApplicableReason: 'budget' })
  })
})

describe('discovery checks', () => {
  const llms = (body: string, contentType = 'text/plain') => outcome('https://x.test/llms.txt', { text: body, contentType })

  it('llms.txt passes, fails, and becomes not applicable only when skipped for budget', () => {
    expect(run('discovery.llms_txt', facts([good(ROOT)], { llms: { attempts: [llms('# A')], hit: llms('# A'), skippedForBudget: false } })).status).toBe('pass')
    expect(run('discovery.llms_txt', facts([good(ROOT)], { llms: { attempts: [llms('<html>', 'text/html')], hit: null, skippedForBudget: false } })).status).toBe('fail')
    expect(run('discovery.llms_txt', facts([good(ROOT)], { llms: { attempts: [], hit: null, skippedForBudget: true } }))).toMatchObject({ status: 'not_applicable', notApplicableReason: 'budget' })
  })

  it('llms-full.txt needs non-HTML text over 1024 bytes, and is N/A only when skipped for budget', () => {
    const full = (bytes: number, contentType = 'text/plain') => outcome('https://x.test/llms-full.txt', { text: 'a'.repeat(bytes), contentType })
    const probe = (o: FetchOutcome, hit: boolean) => ({ llmsFull: { attempts: [o], hit: hit ? o : null, skippedForBudget: false } })
    // The gatherer sets `hit` from isValidLlmsFull; check that rule directly too.
    expect(isValidLlmsFull(full(1025))).toBe(true)
    expect(isValidLlmsFull(full(1024))).toBe(false)
    expect(isValidLlmsFull(full(5000, 'text/html'))).toBe(false)
    expect(run('discovery.llms_full_txt', facts([good(ROOT)], probe(full(1025), true))).status).toBe('pass')
    expect(run('discovery.llms_full_txt', facts([good(ROOT)], probe(full(1024), false))).status).toBe('fail')
    expect(run('discovery.llms_full_txt', facts([good(ROOT)], { llmsFull: { attempts: [], hit: null, skippedForBudget: true } })))
      .toMatchObject({ status: 'not_applicable', notApplicableReason: 'budget' })
  })

  it('sitemap is N/A only when its probe was skipped for budget', () => {
    expect(run('discovery.sitemap', facts([good(ROOT)], { sitemap: { attempts: [], parsed: [], locsUnderRoot: 0, skippedForBudget: true } })))
      .toMatchObject({ status: 'not_applicable', notApplicableReason: 'budget' })
  })

  it('sitemap passes with a loc under the root and fails otherwise', () => {
    const sitemap = { attempts: [outcome('https://x.test/sitemap.xml')], parsed: ['https://x.test/sitemap.xml'], locsUnderRoot: 3, skippedForBudget: false }
    expect(run('discovery.sitemap', facts([good(ROOT)], { sitemap })).status).toBe('pass')
    expect(run('discovery.sitemap', facts([good(ROOT)], { sitemap: { ...sitemap, locsUnderRoot: 0 } })).status).toBe('fail')
  })

  it('robots AI-agent check reports blocked bots without being scored', () => {
    const rules = parseRobots('User-agent: GPTBot\nDisallow: /\n')
    const result = run('discovery.robots_ai_agents', facts([good(ROOT)], { robots: { rules, found: true } }))
    expect(result).toMatchObject({ status: 'fail', value: 0, detail: 'robots.txt blocks GPTBot on the docs root.' })
    expect(run('discovery.robots_ai_agents', facts([good(ROOT)])).status).toBe('pass')
  })

  it('agent manifest passes via well-known JSON, an MCP URL in llms.txt, or rel=mcp', () => {
    const manifest = outcome('https://x.test/m.json', { contentType: 'application/json', text: '{"a":1}' })
    expect(run('discovery.agent_manifest', facts([good(ROOT)], { wellKnown: { attempts: [manifest], hit: manifest, skippedForBudget: false } })).status).toBe('pass')
    const withMcp = llms('# Docs\n- [Server](https://example.test/api/mcp)')
    const endpoint = outcome('https://example.test/api/mcp', { status: 405, contentType: 'application/json', text: '{}' })
    expect(run('discovery.agent_manifest', facts([good(ROOT)], {
      llms: { attempts: [withMcp], hit: withMcp, skippedForBudget: false },
      mcpEndpoint: { url: 'https://example.test/api/mcp', outcome: endpoint, isEndpoint: true, skippedForBudget: false },
    })).status).toBe('pass')
    const relMcp = page(ROOT, '<html><head><link rel="mcp" href="https://x.test/mcp"></head></html>')
    expect(run('discovery.agent_manifest', facts([relMcp])).status).toBe('pass')
    expect(run('discovery.agent_manifest', facts([good(ROOT)], { rootLinkHeaderMcp: true })).status).toBe('pass')
    const noMcp = llms('# Docs\n- [Guide](https://example.test/guide)')
    expect(run('discovery.agent_manifest', facts([good(ROOT)], { llms: { attempts: [noMcp], hit: noMcp, skippedForBudget: false } })).status).toBe('fail')
    expect(run('discovery.agent_manifest', facts([good(ROOT)], { wellKnown: { attempts: [], hit: null, skippedForBudget: true } })).notApplicableReason).toBe('budget')
  })
})

describe('retrieval.alternate and parity', () => {
  const probe = 'https://x.test/a'
  const attempt = (overrides: Partial<AlternateAttempt>): AlternateAttempt => ({
    variant: 'dot_md', url: `${probe}.md`, kind: 'markdown', outcome: outcome(`${probe}.md`), valid: true, ...overrides,
  })

  it('alternate passes on a hit, fails when tried and missing, N/A when every variant was skipped for budget', () => {
    const pages = [good(ROOT), good(probe)]
    const hit = attempt({})
    expect(run('retrieval.alternate', facts(pages, { alternate: { probePage: probe, attempts: [hit], hit, title: 'Install' } })).status).toBe('pass')
    expect(run('retrieval.alternate', facts(pages, { alternate: { probePage: probe, attempts: [attempt({ valid: false })], hit: null, title: null } })).status).toBe('fail')
    const skipped = attempt({ outcome: null, valid: false, skipped: 'budget' })
    expect(run('retrieval.alternate', facts(pages, { alternate: { probePage: probe, attempts: [skipped, skipped], hit: null, title: null } })).notApplicableReason).toBe('budget')
  })

  it('parity.title compares the normalized alternate title with the H1 or title prefix', () => {
    const pages = [good(ROOT), good(probe)]
    const hit = attempt({})
    const withTitle = (title: string) => facts(pages, { alternate: { probePage: probe, attempts: [hit], hit, title } })
    expect(run('parity.title', withTitle('Install')).status).toBe('pass')
    expect(run('parity.title', withTitle('  INSTALL!  ')).status).toBe('pass')
    expect(run('parity.title', withTitle('Uninstall')).status).toBe('fail')
    expect(run('parity.title', facts(pages))).toMatchObject({ status: 'not_applicable', notApplicableReason: 'no_alternate' })
  })

  it('parity.description compares meta and JSON-LD descriptions where both exist', () => {
    const same = page(ROOT, docPage({ url: ROOT, title: 'A', description: 'Same text.' }))
    const different = page('https://x.test/d', docPage({ url: 'https://x.test/d', title: 'D', description: 'Meta', jsonLd: { '@type': 'WebPage', description: 'Other' } }))
    const noLd = page('https://x.test/n', '<html><head><meta name="description" content="x"></head></html>')
    expect(run('parity.description', facts([same, different, noLd]))).toMatchObject({ value: 0.5, pages: { passed: 1, applicable: 2 } })
    expect(run('parity.description', facts([noLd]))).toMatchObject({ status: 'not_applicable', notApplicableReason: 'no_comparable_pages' })
  })
})
