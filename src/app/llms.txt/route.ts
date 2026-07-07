import { siteConfig } from '@/data/site'
import { getDocEntries, getSidebarCollections } from '@/data/docs'
import { getSiteUrl } from '@/lib/site-url'

const baseUrl = getSiteUrl()

export async function GET() {
  const entries = getDocEntries()
  const collections = getSidebarCollections()

  const lines: Array<string> = []

  // Header
  lines.push(`# ${siteConfig.name}`)
  lines.push('')
  lines.push(`> ${siteConfig.description}`)
  lines.push('')

  // Links
  lines.push(`- Documentation: ${baseUrl}`)
  if (siteConfig.repoUrl && !siteConfig.repoUrl.includes('your-org')) {
    lines.push(`- GitHub: ${siteConfig.repoUrl}`)
  }
  lines.push(`- Full docs for LLMs: ${baseUrl}/llms-full.txt`)
  lines.push(`- Agent discovery (ai.txt): ${baseUrl}/ai.txt`)
  lines.push(`- Structured docs index (JSON): ${baseUrl}/api/docs-index`)
  lines.push(`- OpenAPI spec: ${baseUrl}/openapi.yaml`)
  lines.push('')
  lines.push('## For AI agents')
  lines.push('')
  lines.push('Every page supports content negotiation on its human URL:')
  lines.push(`- JSON API: append \`?format=json\` or send \`Accept: application/json\``)
  lines.push(`- JSON-LD: append \`?format=ldjson\` or send \`Accept: application/ld+json\``)
  lines.push(`- Markdown: append \`?format=md\` or send \`Accept: text/markdown\``)
  lines.push(`- Per-page API: ${baseUrl}/api/docs/{page-id}`)
  lines.push(`- Capability manifest (skill): ${baseUrl}/skill.md`)
  lines.push(`- Agent guidance (editing these docs): ${baseUrl}/AGENTS.md`)
  lines.push(`- MCP server (attach docs as native tools): ${baseUrl}/api/mcp`)
  lines.push('')

  // Sections grouped by tab > group
  for (const collection of collections) {
    if (collection.href || collection.api) continue // skip link tabs and API tabs

    lines.push(`## ${collection.label}`)
    lines.push('')

    for (const section of collection.sections) {
      if (section.title) {
        lines.push(`### ${section.title}`)
        lines.push('')
      }

      for (const item of section.items) {
        const entry = entries.find((e) => e.href === item.href)
        const desc = entry?.description || item.description || ''
        const url = `${baseUrl}${item.href}`
        lines.push(`- [${item.title}](${url})${desc ? `: ${desc}` : ''}`)
      }
      lines.push('')
    }
  }

  // Optional: API reference mention
  const apiCollection = collections.find((c) => c.api)
  if (apiCollection) {
    lines.push(`## ${apiCollection.label}`)
    lines.push('')
    lines.push(`Interactive API reference available at ${baseUrl}/api`)
    lines.push('')
  }

  const body = lines.join('\n')

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
