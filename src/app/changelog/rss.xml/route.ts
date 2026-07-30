import { resolveRequestSiteConfig } from '@/lib/site-config'

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
    description: 'Initial documentation release.',
    items: [
      'Documentation site published',
      'Search and responsive navigation available',
      'Machine-readable documentation endpoints available',
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

export async function GET(request: Request) {
  const effectiveSite = await resolveRequestSiteConfig()
  const baseUrl = new URL(request.url).origin
  const items = entries
    .map(
      (entry) => `    <item>
      <title>${escapeXml(`${effectiveSite.name} ${entry.version}`)}</title>
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
    <title>${escapeXml(effectiveSite.name)} Changelog</title>
    <link>${baseUrl}/changelog</link>
    <description>${escapeXml(`Latest updates to ${effectiveSite.name}`)}</description>
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
