/**
 * Canonical metadata for the site's MCP tools — the SINGLE SOURCE OF TRUTH for
 * each tool's name, description, and inputSchema.
 *
 * This module is intentionally DEPENDENCY-FREE: it imports nothing from the
 * search engine, content pipeline, `@/data/docs`, or agent-readiness. That keeps
 * it safe to import from a client component (`web-mcp-tools.tsx`) and from
 * lightweight routes (`/.well-known/*`) WITHOUT dragging @orama/orama +
 * unified/remark/MDX into their cold-start bundles. The server-side `handler`s
 * (which do need those deps) are attached separately in `site-tools.ts`.
 */

export interface McpToolMetadata {
  name: string
  description: string
  /** JSON Schema for the tool's arguments (always an object, per MCP spec). */
  inputSchema: Record<string, unknown>
}

export const toolMetadata: Array<McpToolMetadata> = [
  {
    name: 'search_docs',
    description:
      'Full-text search across all documentation pages. Returns ranked matches with title, URL, and a snippet.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        limit: { type: 'number', description: 'Maximum number of results (default 8, max 25).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_page',
    description: 'Read the full Markdown content of a documentation page by its page ID or URL path.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'Page ID or URL path, e.g. "guides/authentication".',
        },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'list_pages',
    description: 'List every documentation page with its ID, title, and URL.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'agent_readiness',
    description:
      "Get this site's Agent Readiness Score (0-100) — a deterministic measure of how well the docs serve AI agents, with per-signal subscores.",
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
]

export function getToolMetadata(name: string): McpToolMetadata | undefined {
  return toolMetadata.find((tool) => tool.name === name)
}
