import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { siteConfig } from '@/data/site'
import { getDocEntries, getSidebarCollections } from '@/data/docs'
import { getSiteUrl } from '@/lib/site-url'

const baseUrl = getSiteUrl()
const CONTENT_ROOT = path.join(process.cwd(), 'src/content')

function readRawContent(pageId: string): string | null {
  const candidates = [
    path.join(CONTENT_ROOT, `${pageId}.mdx`),
    path.join(CONTENT_ROOT, `${pageId}/index.mdx`),
  ]

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8')
      const { content } = matter(raw)
      // Strip JSX component tags but keep their text content
      return content
        .replace(/<\/?(?:Steps|Step|Tabs|Tab|Note|Callout|CodeGroup|CardGroup|Card|Frame|Accordion|Columns|Tooltip)[^>]*>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    }
  }

  return null
}

export async function GET() {
  const entries = getDocEntries()
  const collections = getSidebarCollections()

  const lines: Array<string> = []

  // Header
  lines.push(`# ${siteConfig.name} — Complete Documentation`)
  lines.push('')
  lines.push(`> ${siteConfig.description}`)
  lines.push('')
  lines.push(`Source: ${baseUrl}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  // Emit each doc page in sidebar order
  for (const collection of collections) {
    if (collection.href || collection.api) continue

    for (const section of collection.sections) {
      for (const item of section.items) {
        const entry = entries.find((e) => e.href === item.href)
        if (!entry) continue

        const content = readRawContent(entry.id)
        if (!content) continue

        lines.push(`# ${entry.title}`)
        lines.push('')
        if (entry.description) {
          lines.push(`> ${entry.description}`)
          lines.push('')
        }
        lines.push(`URL: ${baseUrl}${entry.href}`)
        lines.push('')
        lines.push(content)
        lines.push('')
        lines.push('---')
        lines.push('')
      }
    }
  }

  const body = lines.join('\n')

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
