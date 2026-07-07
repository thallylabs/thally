import { siteConfig } from '@/data/site'
import { getSiteUrl } from '@/lib/site-url'

const baseUrl = getSiteUrl()

interface ChangelogEntry {
  version: string
  date: string
  description: string
  items: Array<string>
}

// Users can extend this array with their own changelog entries.
// In a future iteration this could be read from MDX files or a JSON file.
const entries: Array<ChangelogEntry> = [
  {
    version: 'v0.1.0',
    date: '2025-01-01',
    description: 'Initial release of the clean-room Dox template.',
    items: [
      'Next.js App Router foundation with MDX-powered docs',
      'Responsive shell with Radix-driven navigation and search',
      'Shadcn-inspired primitives for buttons, badges, and command palette',
    ],
  },
]

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET() {
  const items = entries
    .map(
      (entry) => `    <item>
      <title>${escapeXml(`${siteConfig.name} ${entry.version}`)}</title>
      <link>${baseUrl}/changelog</link>
      <guid>${baseUrl}/changelog#${entry.version}</guid>
      <pubDate>${new Date(entry.date).toUTCString()}</pubDate>
      <description>${escapeXml(entry.description + '\n' + entry.items.map((i) => `- ${i}`).join('\n'))}</description>
    </item>`,
    )
    .join('\n')

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteConfig.name)} Changelog</title>
    <link>${baseUrl}/changelog</link>
    <description>${escapeXml(`Latest updates to ${siteConfig.name}`)}</description>
    <language>en</language>
    <atom:link href="${baseUrl}/changelog/rss.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`

  return new Response(rss, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
