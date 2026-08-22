import { getDocEntries } from '@/data/docs'
import { getSiteUrl } from '@/lib/site-url'
import type { SiteIdentity } from '@/lib/site-config'

/**
 * `skill.md` — a Claude-skill-shaped manifest that tells an agent what this
 * product is and how to read its docs programmatically. Generated from the
 * content graph so it never drifts from the actual site.
 */
export function buildSkillManifest(identity: SiteIdentity, base = getSiteUrl()): string {
  const entries = getDocEntries()
  const lines: Array<string> = []

  lines.push(`# ${identity.name} — documentation skill`)
  lines.push('')
  lines.push(identity.description)
  lines.push('')
  lines.push('## When to use')
  lines.push(`Use this to answer questions about ${identity.name} from its official documentation.`)
  lines.push('')
  lines.push('## Operating rules')
  lines.push('1. Start with the index or search instead of guessing a page URL.')
  lines.push('2. Read the most relevant pages before answering. Treat documented behavior as fact and label any inference.')
  lines.push('3. Cite the canonical page URLs that support the answer. If the docs do not support a claim, say what is missing.')
  lines.push('4. Prefer Markdown or JSON when extracting facts. Use the human page when layout or interactive behavior matters.')
  lines.push('5. The public MCP server is read-only. Never claim it changed the site, and never request private credentials through documentation tools.')
  lines.push('')
  lines.push('## Read the docs programmatically')
  lines.push(`- Index: ${base}/llms.txt`)
  lines.push(`- Full text (single file): ${base}/llms-full.txt`)
  lines.push(`- Any page as Markdown: append \`.md\` to its URL (e.g. ${base}/quickstart.md)`)
  lines.push(`- Any page as JSON / JSON-LD / Markdown: ${base}/api/docs/{slug}`)
  lines.push(`- Search: ${base}/api/search?q={query}`)
  lines.push(`- Structured index (JSON): ${base}/api/docs-index`)
  lines.push(`- MCP server (attach as native tools over HTTP): ${base}/api/mcp`)
  lines.push(`- Agent readiness report: ${base}/api/agent-readiness`)
  // A configured customer spec is served when present; otherwise this URL
  // describes Thally's built-in read APIs, so it is always dereferenceable.
  lines.push(`- OpenAPI description: ${base}/openapi.yaml`)
  lines.push('')
  lines.push('## Remote MCP tools')
  lines.push('- `search_docs` — find relevant pages before reading deeply')
  lines.push('- `read_page` — read one published page by ID')
  lines.push('- `list_pages` — inspect the published information architecture')
  lines.push('- `agent_readiness` — check whether the site is easy for agents to use')
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
 * project. Doubles as the config surface the `thally agent` (v2.1) reads. A
 * physical `AGENTS.md` at the project root overrides this generated default.
 */
export function buildAgentsManifest(identity: SiteIdentity, base = getSiteUrl()): string {
  const lines: Array<string> = []

  lines.push('# AGENTS.md')
  lines.push('')
  lines.push(`Guidance for AI agents working on the **${identity.name}** documentation.`)
  lines.push('This is a Thally project — a Next.js app. You author content and config; the framework is a hidden runtime you never edit.')
  lines.push('')
  lines.push('## Start every task')
  lines.push('1. Read this file, `docs.json`, and the relevant existing pages before editing.')
  lines.push('2. Search for overlapping guidance. Prefer improving the best existing page over creating a duplicate.')
  lines.push('3. Confirm the requested outcome, repository scope, and actions that need explicit approval.')
  lines.push('')
  lines.push('## Project layout')
  lines.push('- `src/content/*.mdx` — the documentation pages you edit')
  lines.push('- `docs.json` — navigation, tabs, API reference, redirects')
  lines.push('- `src/data/site.ts` — site name, links, brand')
  lines.push('- `src/mdx/custom-components.tsx` — your own MDX components (never edit core)')
  lines.push('- `snippets/` — reusable MDX fragments')
  lines.push('')
  lines.push('## Editing docs')
  lines.push('1. Add or edit a `.mdx` file under `src/content/`. Every page needs specific `title` and outcome-led `description` frontmatter; use `navTitle` when the sidebar label should be shorter.')
  lines.push('2. Register new pages in `docs.json` navigation so they appear in the sidebar.')
  lines.push('3. Reuse the built-in MDX components (Steps, Tabs, Cards, Callouts, CodeGroup, …) — see `src/components/mdx/`.')
  lines.push('4. Write one reader task per page. Put prerequisites before ordered steps, use tested examples, and link to shared prerequisites instead of repeating them.')
  lines.push('5. Keep the structured content graph as the source of truth. Do not build a second parser or hand-edit generated projections.')
  lines.push('')
  lines.push('## Boundaries')
  lines.push('- Do not edit framework internals, generated files, secrets, deployment credentials, or unrelated application code.')
  lines.push('- Do not invent product behavior, commands, flags, URLs, limits, or configuration keys. Verify them in source or official docs.')
  lines.push('- Use Thally Cloud at https://app.thally.io/ to create managed sites. The CLI scaffold is the secondary path for local evaluation, automation, migration, and self-hosting.')
  lines.push('- Do not commit, push, deploy, create repositories, or change external services unless the user explicitly requested that action.')
  lines.push('')
  lines.push('## Before committing')
  lines.push('- Use the repository’s checked-in workflow/tooling lock to run `thally check --ci .`; never download an unpinned checker in a credential-bearing step. Fix content or navigation errors caused by the change.')
  lines.push('- Run `npm run build` and inspect the changed pages in a browser when layout or interaction changed.')
  lines.push('- Summarize changed files, validation results, and any remaining human decisions.')
  lines.push('')
  lines.push('## Machine-readable endpoints')
  lines.push(`- Index: ${base}/llms.txt · full corpus: ${base}/llms-full.txt`)
  lines.push(`- Search: ${base}/api/search?q={query} · pages: ${base}/api/docs/{slug}`)
  lines.push(`- Skill: ${base}/skill.md · MCP: ${base}/api/mcp · readiness: ${base}/api/agent-readiness`)
  lines.push('')
  return lines.join('\n')
}
