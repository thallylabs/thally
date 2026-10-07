/**
 * MCP resources for the remote endpoint: every indexable page, and every
 * published API operation, as a readable Markdown resource.
 *
 * URIs use a custom `docs://` scheme rather than `https://`: the spec reserves
 * `https://` for resources a client can fetch directly, and a page's human URL
 * returns HTML, not the Markdown served here.
 *
 * - `docs://pages/{+pageId}` — the agent Markdown projection (same bytes as
 *   MCP `read_page` and the `.md` mirror).
 * - `docs://api/{+operationId}` — the compact operation Markdown that
 *   `llms-full.txt` embeds.
 *
 * Listing follows the search visibility rule (no hidden/noindex pages), and
 * reading resolves only KNOWN published entries — a URI is never turned into
 * a filesystem path. Both take the request's reader (anonymous when omitted):
 * a page or operation the reader may not open is neither listed nor readable.
 */

import { apiOperationId, apiOperationMarkdown, describeApiOperation } from '@/lib/openapi/operation-projection'
import { listAgentPages, loadVisibleApiOperationNodes, readAgentPage, resolveLocaleArg } from '@/lib/mcp/site-tools'
import { ANONYMOUS_READER, type ReaderContext } from '@/lib/reader-auth/access'

export const PAGE_URI_PREFIX = 'docs://pages/'
export const API_URI_PREFIX = 'docs://api/'

/** Resources per `resources/list` page. */
export const RESOURCE_PAGE_SIZE = 200

export interface McpResource {
  uri: string
  name: string
  title: string
  description?: string
  mimeType: string
}

export interface McpResourceContents {
  uri: string
  mimeType: string
  text: string
}

/** JSON-RPC "Invalid params"; carried on errors for a bad cursor or malformed URI. */
export const INVALID_PARAMS = -32602

function invalidParams(message: string): Error {
  return Object.assign(new Error(message), { rpcCode: INVALID_PARAMS })
}

/** The JSON-RPC code an error raised here maps to, if it is a caller error. */
export function rpcErrorCode(error: unknown): number | undefined {
  const code = (error as { rpcCode?: unknown } | null)?.rpcCode
  return typeof code === 'number' ? code : undefined
}

export const resourceTemplates = [
  {
    uriTemplate: `${PAGE_URI_PREFIX}{+pageId}`,
    name: 'page',
    title: 'Documentation page',
    description: 'Any published documentation page as Markdown, by page ID (e.g. docs://pages/guides/authentication).',
    mimeType: 'text/markdown',
  },
  {
    uriTemplate: `${API_URI_PREFIX}{+operationId}`,
    name: 'api-operation',
    title: 'API operation',
    description: 'One API reference operation as compact Markdown, by operation id (see list_api_operations).',
    mimeType: 'text/markdown',
  },
]

function encodeId(id: string): string {
  return id.split('/').map(encodeURIComponent).join('/')
}

function decodeId(value: string): string {
  try {
    return value.split('/').map(decodeURIComponent).join('/')
  } catch {
    throw invalidParams('Malformed resource URI.')
  }
}

/** Opaque pagination cursor: a base64url offset. Clients must not parse it. */
function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url')
}

function decodeCursor(cursor: unknown): number {
  if (cursor === undefined || cursor === null) return 0
  const decoded = typeof cursor === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(cursor)
    ? Buffer.from(cursor, 'base64url').toString('utf8')
    : ''
  if (!/^\d{1,9}$/.test(decoded)) throw invalidParams('Invalid cursor.')
  return Number(decoded)
}

/** One page of `resources/list`: indexable documentation pages in navigation order. */
export async function listResources(
  cursor: unknown,
  reader: ReaderContext = ANONYMOUS_READER,
): Promise<{ resources: Array<McpResource>; nextCursor?: string }> {
  const offset = decodeCursor(cursor)
  const pages = await listAgentPages(undefined, reader)
  const slice = pages.slice(offset, offset + RESOURCE_PAGE_SIZE)
  const resources = slice.map((entry) => ({
    uri: `${PAGE_URI_PREFIX}${encodeId(entry.id)}`,
    name: entry.id,
    title: entry.title,
    ...(entry.description ? { description: entry.description } : {}),
    mimeType: 'text/markdown',
  }))
  const next = offset + slice.length
  return { resources, ...(next < pages.length ? { nextCursor: encodeCursor(next) } : {}) }
}

/** Read one resource, or null when the URI names nothing published. */
export async function readResource(
  uri: unknown,
  origin: string,
  reader: ReaderContext = ANONYMOUS_READER,
): Promise<McpResourceContents | null> {
  if (typeof uri !== 'string' || !uri) throw invalidParams('Provide a resource "uri".')
  if (uri.startsWith(PAGE_URI_PREFIX)) {
    const locale = await resolveLocaleArg({})
    const page = await readAgentPage(decodeId(uri.slice(PAGE_URI_PREFIX.length)), locale, origin, reader)
    return page ? { uri, mimeType: 'text/markdown', text: page.markdown } : null
  }
  if (uri.startsWith(API_URI_PREFIX)) {
    const id = decodeId(uri.slice(API_URI_PREFIX.length))
    const node = (await loadVisibleApiOperationNodes(reader)).find((candidate) => apiOperationId(candidate) === id)
    return node ? { uri, mimeType: 'text/markdown', text: apiOperationMarkdown(describeApiOperation(node, origin)) } : null
  }
  return null
}
