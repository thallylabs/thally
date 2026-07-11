import { type NextRequest } from 'next/server'
import { toolMetadata } from '@/lib/mcp/tool-metadata'

/**
 * Agent-discovery documents served under `/.well-known/*` (and `/auth.md`),
 * mapped here via rewrites in next.config.ts so every deployment emits
 * absolute URLs for its own origin — no per-site configuration needed.
 *
 * Everything published here describes capability the site actually has:
 * the MCP server at /api/mcp, the search API, Markdown content negotiation,
 * and the public no-auth read model. Standards covered:
 *  - RFC 9727 api-catalog (linkset)
 *  - MCP Server Card (/.well-known/mcp.json, /.well-known/mcp/server-card.json)
 *  - A2A Agent Card (/.well-known/agent-card.json)
 *  - Agent Skills discovery (/.well-known/agent-skills/*)
 *  - RFC 9728 OAuth Protected Resource Metadata
 *  - auth.md (agent-readable auth documentation)
 *
 * Deliberately imports the dependency-free `tool-metadata` (not `site-tools`),
 * so these discovery documents don't drag the search engine + MDX/remark
 * toolchain into their cold-start bundle. No `export const runtime` is needed:
 * nothing here requires the Node runtime (Next defaults to nodejs anyway).
 */

const JSON_TYPE = 'application/json; charset=utf-8'
const LINKSET_TYPE = 'application/linkset+json; charset=utf-8'
const MARKDOWN_TYPE = 'text/markdown; charset=utf-8'

function json(body: unknown, contentType: string = JSON_TYPE): Response {
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'content-type': contentType, 'cache-control': 'public, max-age=300' },
  })
}

function markdown(body: string): Response {
  return new Response(body, {
    headers: { 'content-type': MARKDOWN_TYPE, 'cache-control': 'public, max-age=300' },
  })
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function apiCatalog(origin: string): Response {
  return json(
    {
      linkset: [
        {
          anchor: `${origin}/`,
          'service-desc': [
            { href: `${origin}/openapi.yaml`, type: 'application/yaml', title: 'OpenAPI description' },
          ],
          'service-doc': [
            { href: `${origin}/`, type: 'text/html', title: 'Documentation site' },
            { href: `${origin}/llms.txt`, type: 'text/markdown', title: 'llms.txt index for agents' },
          ],
          'service-meta': [
            { href: `${origin}/auth.md`, type: 'text/markdown', title: 'Authentication guide for agents' },
          ],
          item: [
            { href: `${origin}/api/mcp`, title: 'MCP server (streamable HTTP)' },
            { href: `${origin}/api/search`, title: 'Documentation search API' },
            { href: `${origin}/api/docs-index`, title: 'Machine-readable page index' },
          ],
        },
      ],
    },
    LINKSET_TYPE,
  )
}

function mcpServerCard(origin: string): Response {
  return json({
    name: 'thally-docs',
    title: 'Thally documentation MCP server',
    description:
      'Read-only MCP server exposing this documentation site: full-text search, page reads as Markdown, a page index, and an agent-readiness report.',
    version: '1.0.0',
    protocolVersion: '2025-06-18',
    url: `${origin}/api/mcp`,
    endpoint: `${origin}/api/mcp`,
    transport: ['streamable-http'],
    authentication: { type: 'none' },
    capabilities: { tools: { listChanged: false } },
    tools: toolMetadata.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    documentation: `${origin}/auth.md`,
  })
}

function a2aAgentCard(origin: string): Response {
  // Finding (6): /api/mcp speaks MCP, NOT A2A. It implements only the MCP
  // JSON-RPC methods `initialize`, `ping`, `tools/list`, and `tools/call`
  // (see src/app/api/mcp/route.ts) — and ZERO A2A methods (`message/send`,
  // `tasks/*`). So advertising it under an A2A transport (`preferredTransport:
  // 'JSONRPC'`, which in A2A means "send A2A JSON-RPC here") is categorically
  // false: a compliant A2A client would POST `message/send` and get -32601.
  //
  // Honest fix (keep the discovery document, drop the false protocol claim):
  // the only advertised interface uses transport `MCP` — a value NOT in A2A's
  // transport enum (JSONRPC / GRPC / HTTP+JSON). A spec-compliant A2A client
  // finds no interface it can speak and therefore CANNOT be told to send A2A
  // methods to this MCP endpoint. It routes agents to the canonical MCP
  // discovery doc (mcp-server-card.json) instead. This advertises only what
  // /api/mcp actually implements.
  return json({
    protocolVersion: '0.3.0',
    name: 'Thally Docs Agent',
    description:
      'Documentation agent for this site. Answers questions from the docs corpus via search, Markdown page reads, and a machine-readable page index. Read-only and public. Accessible over MCP (not A2A) — attach with an MCP client.',
    // No A2A service URL is advertised: this agent exposes no A2A transport.
    // The MCP interface is described below via a non-A2A transport annotation.
    url: `${origin}/.well-known/mcp-server-card.json`,
    preferredTransport: 'MCP',
    supportedInterfaces: [
      { url: `${origin}/api/mcp`, transport: 'MCP', protocol: 'MCP' },
    ],
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/markdown', 'application/json'],
    skills: toolMetadata.map((tool) => ({
      id: tool.name,
      name: tool.name,
      description: tool.description,
      tags: ['documentation', 'read-only'],
    })),
    documentationUrl: `${origin}/llms.txt`,
  })
}

function oauthProtectedResource(origin: string): Response {
  // RFC 9728. Honest shape for this site: the docs corpus and its agent
  // surfaces are public and unauthenticated; `authorization_servers` is
  // intentionally absent (it is OPTIONAL) because no OAuth server fronts
  // this resource. auth.md carries the human/agent-readable version.
  return json({
    resource: origin,
    resource_name: 'Thally documentation',
    // Empty by declaration, not omission: no OAuth authorization server
    // fronts this resource (RFC 9728 §2 — the array lists AS issuers).
    authorization_servers: [],
    bearer_methods_supported: [],
    resource_documentation: `${origin}/auth.md`,
  })
}

function authMd(origin: string): Response {
  const host = new URL(origin).host
  return markdown(`# auth.md

You are an agent. This document tells you how to access **${host}** — a
public documentation service. This is the **anonymous** flow: every agent
surface works without registering, provisioning a credential, or claiming
anything. There is no agent-verified or email-verified registration today.

Supported credential types: **none — access is anonymous.** There is no
\`api_key\` issuance, no \`client_id\`/\`client_secret\`, no
\`registration_endpoint\` (OAuth 2.0 Dynamic Client Registration, RFC 7591,
is not offered), and no claim ceremony — there is nothing to claim.

## Step 1 — Discover the surface

| Surface | Auth |
| --- | --- |
| Documentation pages (HTML or Markdown via \`Accept: text/markdown\`) | None |
| \`${origin}/llms.txt\` and \`${origin}/llms-full.txt\` | None |
| Search API — \`GET ${origin}/api/search?q=<query>\` | None |
| Page index — \`GET ${origin}/api/docs-index\` | None |
| MCP server — \`${origin}/api/mcp\` (streamable HTTP) | None |

## Step 2 — Use the API (anonymous, no credential)

\`\`\`
GET /api/search?q=example HTTP/1.1
Host: ${host}
User-Agent: your-agent/1.0
\`\`\`

Do not send an \`Authorization: Bearer\` header — requests carry no
credential, and none will ever be required for the read surface. Identify
honestly via \`User-Agent\` so rate limiting can be fair.

## Step 3 — Attach over MCP (optional)

\`\`\`
claude mcp add --transport http thally ${origin}/api/mcp
\`\`\`

The MCP server accepts anonymous \`initialize\` and \`tools/call\` requests.

## Errors

- \`429\` — per-IP rate limit on MCP tool calls. Back off and retry; the
  limit resets within a minute.
- \`401\`/\`403\` — you have reached an operator-only surface (\`/admin\`,
  \`/api/admin/*\`). These are session-authenticated for human operators,
  disallowed in robots.txt, and have no agent credential exchange. Do not
  retry with credentials; none exist for agents.
`)
}

// ---------------------------------------------------------------------------
// Agent Skills (https://agentskills.io discovery draft)
// ---------------------------------------------------------------------------

interface SkillDoc {
  name: string
  description: string
  body: (origin: string) => string
}

const SKILLS: Record<string, SkillDoc> = {
  'search-docs': {
    name: 'search-docs',
    description: 'Search this documentation site and retrieve ranked, cited results.',
    body: (origin) => `---
name: search-docs
description: Search this documentation site and retrieve ranked, cited results.
---

# Searching this documentation site

Query the search API directly:

\`\`\`
GET ${origin}/api/search?q=<query>&limit=8
\`\`\`

Returns JSON hits with \`title\`, \`url\`, and a matching snippet, ranked by
relevance. No authentication required. Prefer this over crawling pages.
`,
  },
  'read-page-markdown': {
    name: 'read-page-markdown',
    description: 'Fetch any documentation page as clean Markdown instead of HTML.',
    body: (origin) => `---
name: read-page-markdown
description: Fetch any documentation page as clean Markdown instead of HTML.
---

# Reading pages as Markdown

Every documentation page supports content negotiation. Request the page URL
with \`Accept: text/markdown\` to receive the page as Markdown:

\`\`\`
curl -H "Accept: text/markdown" ${origin}/<page-path>
\`\`\`

The full page index lives at \`${origin}/llms.txt\`; the entire corpus in one
file at \`${origin}/llms-full.txt\`.
`,
  },
  'connect-mcp': {
    name: 'connect-mcp',
    description: 'Attach an MCP client to this site and use its docs as native tools.',
    body: (origin) => `---
name: connect-mcp
description: Attach an MCP client to this site and use its docs as native tools.
---

# Connecting over MCP

This site runs a read-only MCP server (streamable HTTP, no auth):

\`\`\`
claude mcp add --transport http thally ${origin}/api/mcp
\`\`\`

Available tools: ${toolMetadata.map((tool) => `\`${tool.name}\``).join(', ')}.
`,
  },
}

function agentSkillsIndex(origin: string): Response {
  return json({
    version: '0.2.0',
    skills: Object.values(SKILLS).map((skill) => ({
      name: skill.name,
      description: skill.description,
      url: `${origin}/.well-known/agent-skills/${skill.name}.md`,
    })),
  })
}

function agentSkillFile(origin: string, file: string | null): Response {
  const name = (file ?? '').replace(/\.md$/, '')
  const skill = SKILLS[name]
  if (!skill) {
    return new Response('Skill not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  }
  return markdown(skill.body(origin))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ document: Array<string> }> },
): Promise<Response> {
  const { document } = await params
  const [name, arg] = document
  const origin = request.nextUrl.origin

  switch (name) {
    case 'api-catalog':
      return apiCatalog(origin)
    case 'mcp-server-card':
      return mcpServerCard(origin)
    case 'agent-card':
      return a2aAgentCard(origin)
    case 'oauth-protected-resource':
      return oauthProtectedResource(origin)
    case 'auth-md':
      return authMd(origin)
    case 'agent-skills-index':
      return agentSkillsIndex(origin)
    case 'agent-skills-file':
      return agentSkillFile(origin, arg ?? null)
    default:
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  }
}
