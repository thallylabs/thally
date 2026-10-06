/**
 * Canonical metadata for the site's MCP tools — the SINGLE SOURCE OF TRUTH for
 * each tool's name, title, description, input/output schemas and behavior
 * annotations. `tools/list`, the MCP server card (`/.well-known/mcp.json`),
 * the admin MCP panel and `skill.md` all read this list.
 *
 * This module is intentionally DEPENDENCY-FREE: it imports nothing from the
 * search engine, content pipeline, `@/data/docs`, or agent-readiness. That keeps
 * it safe to import from a client component and from lightweight routes
 * (`/.well-known/*`) WITHOUT dragging @orama/orama + unified/remark/MDX into
 * their cold-start bundles. The server-side handlers (which do need those
 * deps) are attached separately in `site-tools.ts`.
 *
 * Output schemas describe `structuredContent` (MCP 2025-06-18+). Every tool
 * also returns a readable text block for clients that predate structured
 * output. Every tool is read-only and idempotent: the public endpoint never
 * changes the site.
 */

export interface McpToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface McpToolMetadata {
  name: string
  /** Human-readable display name (MCP 2025-06-18+). */
  title: string
  description: string
  /** JSON Schema for the tool's arguments (always an object, per MCP spec). */
  inputSchema: Record<string, unknown>
  /** JSON Schema for `structuredContent` (always an object, per MCP spec). */
  outputSchema: Record<string, unknown>
  annotations: McpToolAnnotations
  /** One-line summary for `skill.md` and other human-facing tool lists. */
  summary: string
}

const READ_ONLY: Omit<McpToolAnnotations, 'title'> = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  // Tools answer from this site's own published content, not the open web.
  openWorldHint: false,
}

const LOCALE_INPUT = {
  type: 'string',
  description: 'Optional language code (e.g. "es") for a translated site. Defaults to the site\'s default language.',
}

const QUERY_INPUT = { type: 'string', description: 'The search query.' }

const stringArray = { type: 'array', items: { type: 'string' } }

const API_OPERATION_SUMMARY_PROPERTIES = {
  id: { type: 'string', description: 'Operation id for get_api_operation.' },
  title: { type: 'string' },
  method: { type: 'string' },
  path: { type: 'string' },
  description: { type: 'string' },
  group: { type: 'string' },
  tags: stringArray,
  url: { type: 'string', description: 'Human API reference page.' },
  is_webhook: { type: 'boolean' },
}

const API_OPERATION_SUMMARY_REQUIRED = ['id', 'title', 'method', 'path', 'url']

function tool(meta: Omit<McpToolMetadata, 'annotations'>): McpToolMetadata {
  return { ...meta, annotations: { title: meta.title, ...READ_ONLY } }
}

export const toolMetadata: Array<McpToolMetadata> = [
  tool({
    name: 'search_docs',
    title: 'Search documentation',
    summary: 'find relevant pages and API operations before reading deeply',
    description:
      'Full-text search across documentation pages and API operations. Returns ranked matches with title, URL, the best-matching section anchor, and a snippet.',
    inputSchema: {
      type: 'object',
      properties: {
        query: QUERY_INPUT,
        limit: { type: 'number', description: 'Maximum number of results (default 8, max 25).' },
        locale: LOCALE_INPUT,
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        locale: { type: 'string' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['page', 'api_operation'] },
              id: { type: 'string', description: 'Page id (for read_page) or operation id (for get_api_operation).' },
              title: { type: 'string' },
              description: { type: 'string' },
              url: { type: 'string' },
              section_url: { type: 'string', description: 'URL of the best-matching section, when known.' },
              heading: { type: 'string' },
              snippet: { type: 'string' },
              score: { type: 'number' },
              method: { type: 'string' },
              path: { type: 'string' },
            },
            required: ['type', 'id', 'title', 'url', 'snippet', 'score'],
          },
        },
      },
      required: ['query', 'locale', 'results'],
    },
  }),
  tool({
    name: 'search_sections',
    title: 'Search documentation sections',
    summary: 'retrieve the specific sections (with heading path and anchor) that answer a question',
    description:
      'Section-level search: returns the documentation sections that best match the query, each with its heading path, a deep-link URL, and the section text. Use it to answer a question without reading whole pages.',
    inputSchema: {
      type: 'object',
      properties: {
        query: QUERY_INPUT,
        limit: { type: 'number', description: 'Maximum number of sections (default 5, max 20).' },
        locale: LOCALE_INPUT,
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        locale: { type: 'string' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              page_id: { type: 'string' },
              title: { type: 'string', description: 'Page title.' },
              heading: { type: 'string' },
              heading_path: stringArray,
              url: { type: 'string', description: 'Page URL.' },
              section_url: { type: 'string', description: 'Deep link to the section.' },
              content: { type: 'string' },
              score: { type: 'number' },
            },
            required: ['page_id', 'title', 'heading', 'heading_path', 'url', 'section_url', 'content', 'score'],
          },
        },
      },
      required: ['query', 'locale', 'results'],
    },
  }),
  tool({
    name: 'read_page',
    title: 'Read a documentation page',
    summary: 'read one published page as Markdown by ID',
    description: 'Read the full Markdown content of a documentation page by its page ID or URL path.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'Page ID or URL path, e.g. "guides/authentication".',
        },
        locale: LOCALE_INPUT,
      },
      required: ['pageId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        url: { type: 'string' },
        locale: { type: 'string' },
        markdown: { type: 'string' },
        headings: {
          type: 'array',
          items: {
            type: 'object',
            properties: { depth: { type: 'number' }, text: { type: 'string' }, id: { type: 'string' } },
            required: ['depth', 'text', 'id'],
          },
        },
      },
      required: ['page_id', 'title', 'url', 'locale', 'markdown', 'headings'],
    },
  }),
  tool({
    name: 'list_pages',
    title: 'List documentation pages',
    summary: 'inspect the published information architecture',
    description:
      'List every indexable documentation page with its ID, title, and URL. Pages marked hidden or noindex are omitted, exactly as in search.',
    inputSchema: {
      type: 'object',
      properties: { locale: LOCALE_INPUT },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        locale: { type: 'string' },
        total: { type: 'number' },
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              page_id: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              url: { type: 'string' },
            },
            required: ['page_id', 'title', 'url'],
          },
        },
      },
      required: ['locale', 'total', 'pages'],
    },
  }),
  tool({
    name: 'list_api_operations',
    title: 'List API operations',
    summary: 'browse the API reference by method, path, tag, or keyword',
    description:
      'List the published API reference operations (method, path, title, tags). Filter with a keyword (matched against method, path, title and description) or a tag. Use get_api_operation for parameters and schemas.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional keyword filter, e.g. "users" or "POST".' },
        tag: { type: 'string', description: 'Optional tag (case-insensitive).' },
        limit: { type: 'number', description: 'Maximum number of operations (default 50, max 200).' },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        total: { type: 'number', description: 'Matching operations before the limit.' },
        operations: {
          type: 'array',
          items: { type: 'object', properties: API_OPERATION_SUMMARY_PROPERTIES, required: API_OPERATION_SUMMARY_REQUIRED },
        },
      },
      required: ['total', 'operations'],
    },
  }),
  tool({
    name: 'get_api_operation',
    title: 'Get an API operation',
    summary: 'read one API operation: parameters, request/response schemas, auth, and an example',
    description:
      'Describe one API operation: method, path, parameters, request body and response schemas, authentication, and a cURL example with placeholder credentials. Identify it by operationId (from list_api_operations or search_docs) or by method and path.',
    inputSchema: {
      type: 'object',
      properties: {
        operationId: { type: 'string', description: 'Operation id, e.g. "default/posts/get".' },
        method: { type: 'string', description: 'HTTP method, used with path, e.g. "GET".' },
        path: { type: 'string', description: 'Path template, used with method, e.g. "/posts/{id}".' },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        ...API_OPERATION_SUMMARY_PROPERTIES,
        servers: stringArray,
        parameters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              in: { type: 'string', enum: ['path', 'query', 'header', 'cookie'] },
              required: { type: 'boolean' },
              description: { type: 'string' },
              schema: { type: 'object' },
            },
            required: ['name', 'in', 'required'],
          },
        },
        request_body: {
          type: 'object',
          properties: {
            required: { type: 'boolean' },
            description: { type: 'string' },
            content_type: { type: 'string' },
            schema: { type: 'object' },
          },
          required: ['required', 'content_type'],
        },
        responses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              description: { type: 'string' },
              content_type: { type: 'string' },
              schema: { type: 'object' },
            },
            required: ['status'],
          },
        },
        auth: {
          type: 'object',
          properties: {
            required: { type: 'boolean' },
            schemes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  kind: { type: 'string', enum: ['bearer', 'basic', 'apiKey'] },
                  in: { type: 'string', enum: ['header', 'query', 'cookie'] },
                  param_name: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['name', 'kind', 'in', 'param_name'],
              },
            },
          },
          required: ['required', 'schemes'],
        },
        example: {
          type: 'object',
          properties: {
            curl: { type: 'string' },
            response: {
              type: 'object',
              properties: { status: { type: 'string' }, body: { type: 'string' } },
              required: ['status', 'body'],
            },
          },
          required: ['curl'],
        },
      },
      required: [...API_OPERATION_SUMMARY_REQUIRED, 'servers', 'parameters', 'responses', 'auth', 'example'],
    },
  }),
  tool({
    name: 'list_changes',
    title: 'List changelog entries',
    summary: 'read recent changelog entries, optionally since a date',
    description:
      'List entries from the site\'s changelog, newest first, each with its date, title, tags, link, and Markdown body. Pass since (an ISO date such as "2026-01-01") to get only newer entries.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'Optional ISO date; only entries published on or after it are returned.' },
        limit: { type: 'number', description: 'Maximum number of entries (default 20, max 100).' },
        locale: LOCALE_INPUT,
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        changelog_url: { type: ['string', 'null'] },
        total: { type: 'number', description: 'Matching entries before the limit.' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              label: { type: 'string' },
              date: { type: 'string' },
              published: { type: 'string', description: 'ISO 8601, when the authored date is unambiguous.' },
              description: { type: 'string' },
              tags: stringArray,
              url: { type: 'string' },
              markdown: { type: 'string' },
            },
            required: ['id', 'title', 'tags', 'url', 'markdown'],
          },
        },
      },
      required: ['changelog_url', 'total', 'entries'],
    },
  }),
  tool({
    name: 'agent_readiness',
    title: 'Agent Readiness Score',
    summary: 'check whether the site is easy for agents to use',
    description:
      "Get this site's Agent Readiness Score (0-100) — a deterministic measure of how well the docs serve AI agents, with per-signal subscores.",
    inputSchema: { type: 'object', additionalProperties: false },
    // Deliberately loose: the report's signals evolve with the scorer, and a
    // strict schema would break validating clients whenever one is added.
    outputSchema: {
      type: 'object',
      properties: {
        score: { type: 'number' },
        grade: { type: 'string' },
        total_pages: { type: 'number' },
        subscores: { type: 'array', items: { type: 'object' } },
      },
      required: ['score', 'grade'],
    },
  }),
]

export function getToolMetadata(name: string): McpToolMetadata | undefined {
  return toolMetadata.find((tool) => tool.name === name)
}
