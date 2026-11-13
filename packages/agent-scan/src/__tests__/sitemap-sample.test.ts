import { describe, expect, it } from 'vitest'

import { parseRobots } from '../robots.js'
import { bfsCandidates, eligibleUrls, pickSample } from '../sample.js'
import { parseSitemap } from '../sitemap.js'
import { deriveDocsRoot, isUnderRoot } from '../url.js'

const allowAll = parseRobots('')

describe('sitemap parsing', () => {
  it('reads urlset locs and ignores extension elements', () => {
    const parsed = parseSitemap(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <url><loc> https://x.test/a?x=1&amp;y=2 </loc><image:image><image:loc>https://x.test/i.png</image:loc></image:image></url>
      <url><loc><![CDATA[https://x.test/b]]></loc></url></urlset>`)
    expect(parsed).toEqual({ kind: 'urlset', locs: ['https://x.test/a?x=1&y=2', 'https://x.test/b'] })
  })

  it('reads sitemap index children', () => {
    expect(parseSitemap('<sitemapindex><sitemap><loc>https://x.test/s1.xml</loc></sitemap></sitemapindex>'))
      .toEqual({ kind: 'sitemapindex', locs: ['https://x.test/s1.xml'] })
  })

  it('parses a truncated sitemap leniently and rejects non-sitemaps', () => {
    const truncated = parseSitemap('<urlset><url><loc>https://x.test/a</loc></url><url><loc>https://x.test/b</loc></url><url><lo')
    expect(truncated.locs).toEqual(['https://x.test/a', 'https://x.test/b'])
    expect(parseSitemap('<html><body>nope</body></html>')).toEqual({ kind: null, locs: [] })
  })
})

describe('docs root rules', () => {
  it('derives directory roots from the final URL', () => {
    expect(deriveDocsRoot('https://x.test/docs', 'https://x.test/docs')).toBe('https://x.test/docs/')
    expect(deriveDocsRoot('https://x.test/docs', 'https://x.test/docs/intro')).toBe('https://x.test/docs/')
    expect(deriveDocsRoot('https://x.test/', 'https://docs.x.test/')).toBe('https://docs.x.test/')
    expect(deriveDocsRoot('https://x.test', 'https://x.test/')).toBe('https://x.test/')
  })

  it('matches under the root segment-safely', () => {
    expect(isUnderRoot('https://x.test/docs/a', 'https://x.test/docs/')).toBe(true)
    expect(isUnderRoot('https://x.test/docsearch', 'https://x.test/docs/')).toBe(false)
    expect(isUnderRoot('https://y.test/docs/a', 'https://x.test/docs/')).toBe(false)
  })
})

describe('deterministic sampling (AC4)', () => {
  const root = 'https://x.test/docs/'
  const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://x.test/docs/p${String(i).padStart(2, '0')}`)

  it('takes everything when there are at most 10 URLs', () => {
    expect(pickSample(eligibleUrls(urls(7), root, allowAll))).toHaveLength(7)
  })

  it('takes every k-th URL (n = 37 gives k = 3, indices 0..27)', () => {
    const sorted = eligibleUrls(urls(37), root, allowAll)
    const picked = pickSample(sorted)
    expect(picked).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27].map((i) => sorted[i]))
  })

  it('is independent of input order and duplicates', () => {
    const base = urls(37)
    const shuffled = [...base].reverse().concat(base.slice(0, 5), base.slice(3, 4).map((u) => `${u}/`), [`${base[8]}#frag`])
    expect(pickSample(eligibleUrls(shuffled, root, allowAll))).toEqual(pickSample(eligibleUrls(base, root, allowAll)))
  })

  it('sorts by code unit, not locale', () => {
    const sorted = eligibleUrls(['https://x.test/docs/a', 'https://x.test/docs/B', 'https://x.test/docs/_'], root, allowAll)
    expect(sorted).toEqual(['https://x.test/docs/B', 'https://x.test/docs/_', 'https://x.test/docs/a'])
  })

  it('excludes the root, other origins, other paths and robots-disallowed URLs before selection', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /docs/private\n')
    const eligible = eligibleUrls([
      'https://x.test/docs/', 'https://x.test/docs', 'https://y.test/docs/a', 'https://x.test/blog/a',
      'https://x.test/docs/private/a', 'https://x.test/docs/ok', 'HTTPS://X.TEST:443/docs/ok2',
    ], root, robots)
    expect(eligible).toEqual(['https://x.test/docs/ok', 'https://x.test/docs/ok2'])
  })

  it('filters BFS links in document order', () => {
    const links = ['https://x.test/docs/b', 'https://x.test/docs/a.pdf', 'https://x.test/docs/a', 'https://x.test/docs/b/', 'https://x.test/other']
    expect(bfsCandidates(links, root, allowAll, [root])).toEqual(['https://x.test/docs/b', 'https://x.test/docs/a'])
  })
})
