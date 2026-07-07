import { siteConfig } from '@/data/site'
import { getDocEntries } from '@/data/docs'
import { getSiteUrl } from '@/lib/site-url'
import { apiReferenceConfig } from '@/config/api-reference'

/**
 * `skill.md` — a Claude-skill-shaped manifest that tells an agent what this
 * product is and how to read its docs programmatically. Generated from the
 * content graph so it never drifts from the actual site.
 */
export function buildSkillManifest(): string {
  const base = getSiteUrl()
  const entries = getDocEntries()
  const hasApi = apiReferenceConfig.specs.length > 0
  const lines: Array<string> = []

  lines.push(`# ${siteConfig.name} — documentation skill`)
  lines.push('')
  lines.push(siteConfig.description)
  lines.push('')
  lines.push('## When to use')
  lines.push(`Use this to answer questions about ${siteConfig.name} from its official documentation.`)
  lines.push('')
  lines.push('## Read the docs programmatically')
  lines.push(`- Index: ${base}/llms.txt`)
  lines.push(`- Full text (single file): ${base}/llms-full.txt`)
  lines.push(`- Any page as Markdown: append \`.md\` to its URL (e.g. ${base}/quickstart.md)`)
  lines.push(`- Any page as JSON / JSON-LD / Markdown: ${base}/api/docs/{slug}`)
  lines.push(`- Search: ${base}/api/search?q={query}`)
  lines.push(`- Structured index (JSON): ${base}/api/docs-index`)
  lines.push(`- MCP server (attach as native tools over HTTP): ${base}/api/mcp`)
  if (hasApi) lines.push(`- OpenAPI spec: ${base}/openapi.yaml`)
  lines.push('')
  lines.push('## Pages')
  for (const entry of entries) {
    const desc = entry.description ? ` — ${entry.description}` : ''
    lines.push(`- [${entry.title}](${base}${entry.href})${desc}`)
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * `AGENTS.md` — repo-agent-shaped guidance for an agent *editing* this docs
 * project. Doubles as the config surface the `dox agent` (v2.1) reads. A
 * physical `AGENTS.md` at the project root overrides this generated default.
 */
export function buildAgentsManifest(): string {
  const base = getSiteUrl()
  const lines: Array<string> = []

  lines.push('# AGENTS.md')
  lines.push('')
  lines.push(`Guidance for AI agents working on the **${siteConfig.name}** documentation.`)
  lines.push('This is a Dox project — a Next.js app. You author content and config; the framework is a hidden runtime you never edit.')
  lines.push('')
  lines.push('## Project layout')
  lines.push('- `src/content/*.mdx` — the documentation pages you edit')
  lines.push('- `docs.json` — navigation, tabs, API reference, redirects')
  lines.push('- `src/data/site.ts` — site name, links, brand')
  lines.push('- `src/mdx/custom-components.tsx` — your own MDX components (never edit core)')
  lines.push('- `snippets/` — reusable MDX fragments')
  lines.push('')
  lines.push('## Editing docs')
  lines.push('1. Add or edit a `.mdx` file under `src/content/`. Every page needs frontmatter: `title`, `description`, and ideally `keywords`.')
  lines.push('2. Register new pages in `docs.json` navigation so they appear in the sidebar.')
  lines.push('3. Reuse the built-in MDX components (Steps, Tabs, Cards, Callouts, CodeGroup, …) — see `src/components/mdx/`.')
  lines.push('4. Keep pages substantive and well-structured (headings + real content) so they score well for AI agents.')
  lines.push('')
  lines.push('## Before committing')
  lines.push('- Run `dox check` (content lint + Agent Readiness Score) and fix anything it flags.')
  lines.push('- Open a pull request for review — never push docs changes directly.')
  lines.push('')
  lines.push('## Machine-readable endpoints')
  lines.push(`- ${base}/llms.txt · ${base}/api/search · ${base}/api/docs/{slug} · ${base}/api/agent-readiness`)
  lines.push('')
  return lines.join('\n')
}
