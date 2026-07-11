import { type NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { siteTools, getSiteTool } from '@/lib/mcp/site-tools'
import { getStorage } from '@/lib/storage'
import { getAdminSettings } from '@/lib/admin/settings'

export const runtime = 'nodejs'

/**
 * Remote MCP endpoint (A6) — streamable-HTTP, stateless. Any MCP client attaches
 * with `claude mcp add --transport http https://<site>/api/mcp` and gets the
 * site's docs as native tools (search, read, list, readiness). Read-only and
 * public; write tools and private-docs auth land with A1/C1.
 *
 * Implemented as plain JSON-RPC 2.0 (no SDK — the app carries none, and the
 * SDK's transport targets Node req/res, not Web Requests).
 */

const SERVER_INFO = { name: 'thally-docs', version: '1.0.0' }
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const LATEST_PROTOCOL = '2025-06-18'

/** Per-IP ceiling on tool calls per minute (0 disables). */
const RATE_PER_MIN = Number.parseInt((process.env.THALLY_MCP_RATE_PER_MIN ?? process.env.DOX_MCP_RATE_PER_MIN) ?? '60', 10)

interface JsonRpcMessage {
  jsonrpc?: string
  id?: unknown
  method?: string
  params?: Record<string, unknown>
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

async function handleMessage(msg: JsonRpcMessage): Promise<object | null> {
  const { id, method, params } = msg

  // Notifications carry no id and expect no response.
  if (typeof method === 'string' && method.startsWith('notifications/')) return null

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion
      const protocolVersion =
        typeof requested === 'string' && SUPPORTED_PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      })
    }

    case 'ping':
      return rpcResult(id, {})

    case 'tools/list':
      return rpcResult(id, {
        tools: siteTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      })

    case 'tools/call': {
      const name = typeof params?.name === 'string' ? params.name : ''
      const tool = getSiteTool(name)
      // Tool-level failures go in the result with isError — NOT a JSON-RPC error,
      // which is reserved for protocol faults.
      if (!tool) {
        return rpcResult(id, {
          content: [{ type: 'text', text: `Unknown tool: ${name || '(none)'}` }],
          isError: true,
        })
      }
      try {
        const args = (params?.arguments as Record<string, unknown>) ?? {}
        const text = await tool.handler(args)
        return rpcResult(id, { content: [{ type: 'text', text }] })
      } catch (err) {
        return rpcResult(id, {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        })
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method ?? '(none)'}`)
  }
}

export async function POST(request: NextRequest) {
  // Admins can disable the public MCP endpoint from the dashboard.
  if ((await getAdminSettings()).mcpEnabled === false) {
    return Response.json(rpcError(null, -32601, 'MCP endpoint is disabled.'), { status: 404 })
  }

  let body: JsonRpcMessage | Array<JsonRpcMessage>
  try {
    body = await request.json()
  } catch {
    return Response.json(rpcError(null, -32700, 'Parse error'), { status: 400 })
  }

  const messages = Array.isArray(body) ? body : [body]

  // Rate-limit the expensive path (tool calls) per IP — fail open. Count EVERY
  // tool call in the batch, not just one per request, or a single batched array
  // of N tools/call bypasses the ceiling.
  const toolCallCount = messages.filter((m) => m?.method === 'tools/call').length
  if (toolCallCount > 0 && RATE_PER_MIN > 0) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    try {
      const { count } = await getStorage().kvIncrement('mcp_rate', ip, { ttlMs: 60_000, amount: toolCallCount })
      if (count > RATE_PER_MIN) {
        const id = Array.isArray(body) ? null : body?.id
        return Response.json(rpcError(id, -32000, 'Rate limit exceeded. Please slow down.'), { status: 429 })
      }
    } catch {
      // storage hiccup must never block a request
    }
  }

  // Issue a session id on initialize; echo any the client already holds.
  const incomingSession = request.headers.get('mcp-session-id')
  const isInitialize = messages.some((m) => m?.method === 'initialize')
  const sessionId = incomingSession ?? (isInitialize ? randomUUID() : null)
  const headers = sessionId ? { 'mcp-session-id': sessionId } : undefined

  const responses: Array<object> = []
  for (const msg of messages) {
    const res = await handleMessage(msg)
    if (res) responses.push(res)
  }

  // A batch of only notifications (e.g. notifications/initialized) → 202, no body.
  if (responses.length === 0) {
    return new Response(null, { status: 202, headers })
  }

  return Response.json(Array.isArray(body) ? responses : responses[0], { headers })
}

export function GET() {
  // Streamable-HTTP GET opens a server→client SSE stream; this stateless server
  // never pushes, so it's POST-only.
  return new Response('Thally MCP endpoint — POST JSON-RPC 2.0 (streamable HTTP).', {
    status: 405,
    headers: { Allow: 'POST' },
  })
}
