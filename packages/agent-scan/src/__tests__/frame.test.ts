import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildFrame } from '../frame/frame.js'
import { normalizeHomepage } from '../frame/docs-root.js'
import { noopRateLimiter } from '../net/rate-limiter.js'
import { parseCsvRecords } from '../output/csv.js'
import { createFakeTransport, docPage, html, notFound, type FakeRoutes } from './helpers.js'

const API = 'https://api.github.com/search/repositories?q=stars%3A%3E1000&sort=stars&order=desc&per_page=100&page='

function repo(id: number, name: string, homepage: string | null) {
  return { id, full_name: name, stargazers_count: 1000 - id, archived: id === 3, homepage }
}

function routes(): FakeRoutes {
  const dns = { error: 'dns' as const }
  return {
    [`${API}1`]: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        total_count: 9,
        items: [
          repo(1, 'o/nohome', null),
          repo(2, 'o/gh', 'https://github.com/o/gh'),
          repo(3, 'o/sub', 'https://sub.example.com'),
          repo(4, 'o/uk', 'www.example.co.uk'),
          repo(5, 'o/pages', 'https://o.github.io/proj'),
          repo(6, 'o/dupe', 'https://example.com/'),
          repo(7, 'o/link', 'https://link.test/'),
          repo(8, 'o/none', 'https://none.test/'),
          repo(9, 'o/down', 'https://down.test/'),
          repo(9, 'o/down', 'https://down.test/'),
          repo(10, 'o/bad', 'http://exa mple.com'),
        ],
      }),
    },
    'https://docs.example.com/robots.txt': notFound,
    'https://docs.example.com/': html(docPage({ url: 'https://docs.example.com/', title: 'Docs' })),
    'https://docs.example.co.uk/robots.txt': notFound,
    'https://docs.example.co.uk/': { status: 302, headers: { location: '/en/' } },
    'https://docs.example.co.uk/en/': html('<html><body>Docs</body></html>'),
    'https://docs.o.github.io/robots.txt': dns,
    'https://o.github.io/robots.txt': notFound,
    'https://o.github.io/docs/': notFound,
    'https://o.github.io/proj': html('<html><head><meta name="generator" content="Docusaurus v3"></head></html>'),
    'https://docs.link.test/robots.txt': dns,
    'https://link.test/robots.txt': notFound,
    'https://link.test/docs/': notFound,
    'https://link.test/': html('<html><body><a href="https://elsewhere.test/docs">Docs</a><a href="/blog">Blog</a><a href="/manual/"> Documentation </a></body></html>'),
    'https://link.test/manual/': html('<html><body>Manual</body></html>'),
    'https://docs.none.test/robots.txt': dns,
    'https://none.test/robots.txt': notFound,
    'https://none.test/docs/': notFound,
    'https://none.test/': html('<html><body>Marketing</body></html>'),
    'https://docs.down.test/robots.txt': dns,
    'https://down.test/robots.txt': dns,
  }
}

describe('frame builder (AC6)', () => {
  it('records a decision and reason per repository, dedupes docs roots, and freezes the frame', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-scan-frame-'))
    const transport = createFakeTransport(routes())
    const sleeps: number[] = []
    const rows = await buildFrame({
      out: join(dir, 'sample.csv'),
      limit: 50,
      token: 'secret-token',
      transport,
      rateLimiter: noopRateLimiter(),
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      now: () => new Date('2026-11-12T10:00:00Z'),
      captureDir: join(dir, 'captures'),
    })
    expect(rows.map((row) => [row.repo, row.decision, row.reason, row.docs_root, row.duplicate_of])).toEqual([
      ['o/nohome', 'exclude', 'no_homepage', '', ''],
      ['o/gh', 'exclude', 'github_hosted', '', ''],
      ['o/sub', 'include', 'docs_subdomain', 'https://docs.example.com/', ''],
      ['o/uk', 'include', 'docs_subdomain', 'https://docs.example.co.uk/en/', ''],
      ['o/pages', 'include', 'homepage_is_docs', 'https://o.github.io/proj/', ''],
      ['o/dupe', 'exclude', 'duplicate_docs_root', 'https://docs.example.com/', 'o/sub'],
      ['o/link', 'include', 'homepage_docs_link', 'https://link.test/manual/', ''],
      ['o/none', 'exclude', 'no_docs_found', '', ''],
      ['o/down', 'exclude', 'unreachable', '', ''],
      ['o/bad', 'exclude', 'invalid_homepage', '', ''],
    ])
    // Only the search API carries the token, and it is never captured.
    const authorized = transport.requests.filter((r) => r.headers.authorization)
    expect(authorized.map((r) => r.url)).toEqual([`${API}1`])
    const captured = readdirSync(join(dir, 'captures', 'frame'))
    expect(captured).toContain('exchanges.jsonl')
    for (const file of ['exchanges.jsonl', 'meta.json']) expect(readFileSync(join(dir, 'captures', 'frame', file), 'utf8')).not.toContain('secret-token')
    // Never probes a bare public suffix.
    expect(transport.requests.map((r) => r.url).some((url) => url.includes('docs.co.uk') || url.includes('docs.github.io'))).toBe(false)

    const csv = parseCsvRecords(readFileSync(join(dir, 'sample.csv'), 'utf8'))
    expect(Object.keys(csv[0])).toEqual(['rank', 'repo', 'repo_id', 'stars', 'archived', 'homepage', 'docs_root', 'decision', 'reason', 'duplicate_of', 'frozen_on'])
    expect(csv[2]).toMatchObject({ rank: '3', repo: 'o/sub', archived: 'true', frozen_on: '2026-11-12' })
    const meta = JSON.parse(readFileSync(join(dir, 'frame-meta.json'), 'utf8'))
    expect(meta).toMatchObject({ frozenOn: '2026-11-12', query: 'stars:>1000', totalCount: 9, fetched: 11, unique: 10, included: 4 })
  })

  it('never sends the token to an overridden API base', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-scan-frame-'))
    const transport = createFakeTransport({
      'http://127.0.0.1:9/search/repositories?q=stars%3A%3E1000&sort=stars&order=desc&per_page=100&page=1': {
        status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ total_count: 1, items: [repo(1, 'o/a', null)] }),
      },
    })
    await buildFrame({ out: join(dir, 'sample.csv'), limit: 1, token: 'secret-token', apiBase: 'http://127.0.0.1:9', transport, rateLimiter: noopRateLimiter(), sleep: async () => {} })
    expect(transport.requests.some((r) => r.headers.authorization)).toBe(false)
  })

  it('normalizes homepages', () => {
    expect(normalizeHomepage('  ')).toBeNull()
    expect(normalizeHomepage('example.com')).toBe('https://example.com/')
    expect(normalizeHomepage('mailto:a@b.c')).toBe('invalid')
  })

  it('waits for the rate-limit reset on 403 and paces pages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-scan-frame-'))
    const page = (n: number) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ total_count: 150, items: Array.from({ length: n === 1 ? 100 : 50 }, (_, i) => repo(n * 1000 + i, `o/r${n}-${i}`, null)) }),
    })
    const transport = createFakeTransport({
      [`${API}1`]: page(1),
      [`${API}2`]: [{ status: 403, headers: { 'x-ratelimit-reset': '1700000030' } }, page(2)],
    })
    const sleeps: number[] = []
    const rows = await buildFrame({
      out: join(dir, 'sample.csv'),
      limit: 150,
      transport,
      rateLimiter: noopRateLimiter(),
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      now: () => new Date(1_700_000_000_000),
    })
    expect(rows).toHaveLength(150)
    expect(sleeps).toEqual([6500, 30_000])
  })
})
