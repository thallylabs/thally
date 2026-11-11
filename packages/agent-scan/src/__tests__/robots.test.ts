import { describe, expect, it } from 'vitest'

import { allowAllRobots, disallowAllRobots, parseRobots } from '../robots.js'

describe('robots.txt parsing (RFC 9309)', () => {
  it('applies the longest match and prefers Allow on ties', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /docs/\nAllow: /docs/public/\nDisallow: /a\nAllow: /a\n')
    expect(rules.isAllowed('ThallyAgentScan', '/docs/private')).toBe(false)
    expect(rules.isAllowed('ThallyAgentScan', '/docs/public/page')).toBe(true)
    expect(rules.isAllowed('ThallyAgentScan', '/a')).toBe(true)
  })

  it('supports * and $ patterns', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/x\n')
    expect(rules.isAllowed('x', '/file.pdf')).toBe(false)
    expect(rules.isAllowed('x', '/file.pdf?x=1')).toBe(true)
    expect(rules.isAllowed('x', '/tmp123/x')).toBe(false)
  })

  it('selects the group for the product token case-insensitively, else *', () => {
    const body = [
      'User-agent: *', 'Disallow: /',
      '', 'user-agent: thallyagentscan', 'Allow: /',
      '', 'User-agent: GPTBot', 'User-agent: ClaudeBot', 'Disallow: /docs/',
    ].join('\n')
    const rules = parseRobots(body)
    expect(rules.isAllowed('ThallyAgentScan', '/docs/')).toBe(true)
    expect(rules.isAllowed('PerplexityBot', '/docs/')).toBe(false)
    expect(rules.isAllowed('GPTBot', '/docs/x')).toBe(false)
    expect(rules.isAllowed('ClaudeBot', '/other')).toBe(true)
  })

  it('merges groups for the same agent and matches only the product token portion', () => {
    const rules = parseRobots('User-agent: ThallyAgentScan/1.0\nDisallow: /a\n\nUser-agent: thallyagentscan\nDisallow: /b\n')
    expect(rules.isAllowed('ThallyAgentScan', '/a')).toBe(false)
    expect(rules.isAllowed('ThallyAgentScan', '/b')).toBe(false)
    expect(rules.isAllowed('ThallyAgentScan', '/c')).toBe(true)
  })

  it('treats an empty Disallow as allow-all and ignores comments', () => {
    const rules = parseRobots('# hi\nUser-agent: * # everyone\nDisallow:\n')
    expect(rules.isAllowed('x', '/anything')).toBe(true)
  })

  it('collects absolute Sitemap lines in file order', () => {
    const rules = parseRobots('Sitemap: https://x.test/b.xml\nUser-agent: *\nSitemap: /relative.xml\nSitemap: https://x.test/a.xml\n')
    expect(rules.sitemaps).toEqual(['https://x.test/b.xml', 'https://x.test/a.xml'])
  })

  it('models 4xx as allow-all and unreachable as complete disallow, with robots.txt always allowed', () => {
    expect(allowAllRobots().isAllowed('x', '/private')).toBe(true)
    expect(disallowAllRobots().isAllowed('x', '/')).toBe(false)
    expect(disallowAllRobots().isAllowed('x', '/robots.txt')).toBe(true)
  })
})

describe('robots.txt comment handling', () => {
  it('parses about 100 KB of # characters in linear time', () => {
    const body = `${'#'.repeat(100_000)}\nUser-agent: *\nDisallow: /private # trailing comment\n${'#'.repeat(100_000)}x`
    const started = performance.now()
    const rules = parseRobots(body)
    expect(performance.now() - started).toBeLessThan(50)
    expect(rules.isAllowed('ThallyAgentScan', '/private/a')).toBe(false)
    expect(rules.isAllowed('ThallyAgentScan', '/public')).toBe(true)
  })
})
