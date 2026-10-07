/** RSS and JSON Feed are projections of the `<Update>` entries on the changelog page. */

import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ withoutChangelog: false }))

vi.mock('@/data/docs', async () => {
  const { docsModule, entries } = await import('@/lib/mcp/__tests__/agent-surface-fixture')
  return {
    ...docsModule,
    loadDocEntries: async () => state.withoutChangelog ? entries.filter((entry) => entry.id !== 'changelog') : entries,
  }
})
vi.mock('@/lib/content/document', async () => (await import('@/lib/mcp/__tests__/agent-surface-fixture')).contentDocumentModule)
vi.mock('@/lib/site-config', async () => (await import('@/lib/mcp/__tests__/agent-surface-fixture')).siteConfigModule)

import { GET as rss } from '../rss.xml/route'
import { GET as jsonFeed } from '../feed.json/route'
import { HUMAN_ONLY } from '@/lib/mcp/__tests__/agent-surface-fixture'
import { parseChangelogDate } from '@/lib/changelog'
import { escapeXml } from '@/lib/changelog-feeds'

describe('changelog feeds', () => {
  it('serves JSON Feed 1.1 items from the changelog page, newest first', async () => {
    const response = await jsonFeed(new Request('https://docs.acme.test/changelog/feed.json'))
    expect(response.headers.get('content-type')).toContain('application/feed+json')
    const feed = await response.json()
    expect(feed).toMatchObject({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Acme Docs Changelog',
      home_page_url: 'https://docs.acme.test/changelog',
      feed_url: 'https://docs.acme.test/changelog/feed.json',
    })
    expect(feed.items.map((item: { title: string }) => item.title)).toEqual(['Live branding', 'Search', 'v0.1.0'])
    expect(feed.items[0]).toMatchObject({
      id: 'https://docs.acme.test/changelog#live-branding',
      url: 'https://docs.acme.test/changelog#live-branding',
      date_published: '2026-06-20T00:00:00.000Z',
      tags: ['branding'],
    })
    expect(feed.items[1].summary).toBe('Faster search.')
    expect(feed.items[2].date_published).toBeUndefined()
    expect(JSON.stringify(feed)).not.toContain(HUMAN_ONLY)
  })

  it('serves RSS 2.0 with the same entries', async () => {
    const response = await rss(new Request('https://docs.acme.test/changelog/rss.xml'))
    expect(response.headers.get('content-type')).toContain('application/rss+xml')
    const xml = await response.text()
    expect(xml.match(/<item>/g)).toHaveLength(3)
    expect(xml).toContain('<link>https://docs.acme.test/changelog#live-branding</link>')
    expect(xml).toContain('<pubDate>Sat, 20 Jun 2026 00:00:00 GMT</pubDate>')
    expect(xml).toContain('<category>branding</category>')
    expect(xml).not.toContain(HUMAN_ONLY)
  })

  it('404s both feeds when the site has no changelog page', async () => {
    state.withoutChangelog = true
    expect((await rss(new Request('https://docs.acme.test/changelog/rss.xml'))).status).toBe(404)
    expect((await jsonFeed(new Request('https://docs.acme.test/changelog/feed.json'))).status).toBe(404)
    state.withoutChangelog = false
  })
})

describe('changelog helpers', () => {
  it.each([
    ['2026-06-20', '2026-06-20T00:00:00.000Z'],
    ['2026-06-20T10:30:00Z', '2026-06-20T10:30:00.000Z'],
    ['June 20, 2026', '2026-06-20T00:00:00.000Z'],
    ['20 Jun 2026', '2026-06-20T00:00:00.000Z'],
    ['Spring 2025', undefined],
    ['v2', undefined],
    ['2026-13-45', undefined],
  ])('parses %j as %j', (input, expected) => {
    expect(parseChangelogDate(input)).toBe(expected)
  })

  it('escapes XML and drops forbidden control characters', () => {
    expect(escapeXml('a < b & "c" \u0001')).toBe('a &lt; b &amp; &quot;c&quot; ')
  })
})
