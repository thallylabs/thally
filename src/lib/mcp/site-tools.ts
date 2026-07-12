import { searchDocs } from '@/lib/search/engine'
import { getContentDocument } from '@thallylabs/core'
import { getDocEntries } from '@/data/docs'
import { computeAgentReadiness } from '@/lib/agent-readiness'
import { getSiteUrl } from '@/lib/site-url'
import { toolMetadata, type McpToolMetadata } from '@/lib/mcp/tool-metadata'

/**
 * The tools the remote MCP endpoint (A6) exposes to any attached agent. Unlike
 * the `packages/mcp` tools (which operate on a local project directory), these
 * run against the deployed site's own content engine — so an agent attached over
 * HTTP reads exactly what the site serves.
 *
 * Name/description/inputSchema are NOT declared here — they live in the
 * dependency-free `tool-metadata.ts` (single source of truth). This file is the
 * SERVER tool source: it attaches the content-engine-backed `handler`s to that
 * metadata.
 */
export interface McpTool extends McpToolMetadata {
  handler: (args: Record<string, unknown>) => Promise<string>
}

const siteUrl = getSiteUrl()

/** Server-side handlers, keyed by tool name. Joined to the shared metadata below. */
const handlers: Record<string, McpTool['handler']> = {
  search_docs: async (args) => {
    const query = String(args.query ?? '').trim()
    if (!query) return 'Provide a non-empty "query".'
    const limit = typeof args.limit === 'number' ? Math.min(Math.max(1, Math.floor(args.limit)), 25) : 8
    // Full-text only: hybrid mode embeds the query per call — too costly for a
    // public, anonymous endpoint. Rate-limited on top of this.
    const hits = await searchDocs(query, { limit, mode: 'fulltext' })
    if (hits.length === 0) return `No results for "${query}".`
    return hits
      .map((hit, i) => `${i + 1}. ${hit.title} — ${siteUrl}${hit.href}\n   ${hit.snippet}`)
      .join('\n\n')
  },
  read_page: async (args) => {
    const raw = String(args.pageId ?? '')
      .trim()
      .replace(/^\//, '')
    if (!raw) return 'Provide a "pageId".'
    // Resolve to a KNOWN entry only — never pass the raw arg to the content
    // resolver, which path.joins it under CONTENT_ROOT (a "../" would escape
    // and read arbitrary .mdx files on the public endpoint).
    const entry = getDocEntries().find((e) => e.id === raw || e.slug.join('/') === raw)
    if (!entry) return `No page found for "${raw}". Call list_pages to see valid page IDs.`
    const doc = getContentDocument(entry.id)
    if (!doc) return `No page found for "${raw}". Call list_pages to see valid page IDs.`
    return doc.content.markdown
  },
  list_pages: async () => {
    const entries = getDocEntries()
    if (entries.length === 0) return 'This site has no documentation pages yet.'
    return entries.map((e) => `- ${e.id} — ${e.title} (${siteUrl}${e.href})`).join('\n')
  },
  agent_readiness: async () => {
    const report = computeAgentReadiness()
    const lines = [
      `Agent Readiness: ${report.score}/100 (grade ${report.grade}) across ${report.totalPages} page${report.totalPages === 1 ? '' : 's'}.`,
      '',
    ]
    for (const sub of report.subscores) {
      lines.push(
        `- ${sub.label}: ${Math.round(sub.score * 100)}% (weight ${Math.round(sub.weight * 100)}%) — ${sub.detail}`,
      )
    }
    return lines.join('\n')
  },
}

// Join the shared metadata to its server handlers. Order is preserved from
// `toolMetadata`, so `tools/list` output stays byte-identical.
export const siteTools: Array<McpTool> = toolMetadata.map((meta) => ({
  ...meta,
  handler: handlers[meta.name],
}))

export function getSiteTool(name: string): McpTool | undefined {
  return siteTools.find((tool) => tool.name === name)
}
