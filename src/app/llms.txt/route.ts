import { loadSidebarCollections, loadDocEntries } from '@/data/docs'
import { siteUrlMismatch } from '@/lib/site-url'
import { resolveSiteConfig } from '@/lib/site-config'

export async function GET(request: Request) {
  const baseUrl = new URL(request.url).origin
  const effectiveSite = await resolveSiteConfig(baseUrl)
  const entries = await loadDocEntries()
  const collections = await loadSidebarCollections()

  const lines: Array<string> = []

  // Header
  lines.push(`# ${effectiveSite.name}`)
  lines.push('')
  lines.push(`> ${effectiveSite.description}`)
  lines.push('')

  // Links
  lines.push(`- Documentation: ${baseUrl}`)
  if (effectiveSite.repoUrl && !effectiveSite.repoUrl.includes('your-org')) {
    lines.push(`- GitHub: ${effectiveSite.repoUrl}`)
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
  lines.push(`- Search API: ${baseUrl}/api/search?q={query}`)
  lines.push(`- Capability manifest (skill): ${baseUrl}/skill.md`)
  lines.push(`- Agent guidance (editing these docs): ${baseUrl}/AGENTS.md`)
  lines.push(`- MCP server (attach docs as native tools): ${baseUrl}/api/mcp`)
  lines.push(`- Agent readiness: ${baseUrl}/api/agent-readiness`)
  lines.push('')
  lines.push('### Recommended workflow')
  lines.push('')
  lines.push('1. Use this index, the search API, or `search_docs` before choosing a page.')
  lines.push('2. Read the smallest set of relevant pages and follow their prerequisite links.')
  lines.push('3. Treat the published docs as the source of truth. Label inferences and say when evidence is missing.')
  lines.push('4. Cite the canonical human page URLs, not only API endpoints.')
  lines.push('5. Use `/AGENTS.md` before editing a repository. The public MCP server is read-only.')
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

  // Surface a stale-THALLY_SITE_URL misconfiguration (all links above would be
  // dead): warns in server logs and flags it on the response for tooling.
  const mismatch = siteUrlMismatch(baseUrl)

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      ...(mismatch ? { 'X-Thally-Site-Url-Warning': mismatch } : {}),
    },
  })
}
