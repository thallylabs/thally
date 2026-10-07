/**
 * RSS 2.0 and JSON Feed 1.1 projections of the structured changelog
 * (`@/lib/changelog`). Pure functions so both routes, and their tests, share
 * one rendering of each format.
 */

import type { Changelog } from '@/lib/changelog'

export interface FeedSite {
  name: string
  origin: string
}

/** Escape text for XML element content and attribute values. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // XML 1.0 forbids most C0 control characters even when escaped.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

/** Render the changelog as RSS 2.0. Item bodies are the entry Markdown as plain text. */
export function renderChangelogRss(changelog: Changelog, site: FeedSite): string {
  const channelLink = changelog.pageUrl ?? site.origin
  const items = changelog.entries.map((entry) => {
    const body = [entry.description, entry.markdown].filter(Boolean).join('\n\n')
    return [
      '    <item>',
      `      <title>${escapeXml(entry.title)}</title>`,
      `      <link>${escapeXml(entry.url)}</link>`,
      `      <guid isPermaLink="false">${escapeXml(entry.id)}</guid>`,
      ...(entry.published ? [`      <pubDate>${new Date(entry.published).toUTCString()}</pubDate>`] : []),
      ...entry.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
      `      <description>${escapeXml(body)}</description>`,
      '    </item>',
    ].join('\n')
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(`${site.name} Changelog`)}</title>
    <link>${escapeXml(channelLink)}</link>
    <description>${escapeXml(`Latest updates to ${site.name}`)}</description>
    <atom:link href="${escapeXml(`${site.origin}/changelog/rss.xml`)}" rel="self" type="application/rss+xml"/>
${items.join('\n')}
  </channel>
</rss>`
}

/** Render the changelog as JSON Feed 1.1 (https://jsonfeed.org/version/1.1). */
export function renderChangelogJsonFeed(changelog: Changelog, site: FeedSite): Record<string, unknown> {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: `${site.name} Changelog`,
    home_page_url: changelog.pageUrl ?? site.origin,
    feed_url: `${site.origin}/changelog/feed.json`,
    description: `Latest updates to ${site.name}`,
    items: changelog.entries.map((entry) => ({
      id: entry.id,
      url: entry.url,
      title: entry.title,
      content_text: entry.markdown,
      ...(entry.description ? { summary: entry.description } : {}),
      ...(entry.published ? { date_published: entry.published } : {}),
      ...(entry.tags.length ? { tags: entry.tags } : {}),
    })),
  }
}
