/**
 * Bounded OpenAPI request relay for the reader-facing Try It console.
 *
 * The browser supplies parameters, never authority: the target method, path,
 * and origin must match an operation in the site owner's published spec.
 */

import { lookup } from 'node:dns/promises'
import ipaddr from 'ipaddr.js'
import { NextResponse, type NextRequest } from 'next/server'
import { getApiOperationByKey } from '@/data/api-reference'
import type { NormalizedOperation } from '@/lib/openapi/types'
import { readBoundedJson } from '@/lib/http/bounded-json'

export const runtime = 'nodejs'

const MAX_ENVELOPE_BYTES = 384 * 1024
const MAX_UPSTREAM_BODY_BYTES = 256 * 1024
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 10_000
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])
const BLOCKED_HEADERS = new Set([
  'cf-connecting-ip',
  'connection',
  'content-length',
  'cookie',
  'forwarded',
  'host',
  'proxy-authorization',
  'transfer-encoding',
  'upgrade',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-path',
  'x-forwarded-uri',
  'x-http-method',
  'x-original-method',
  'x-original-uri',
  'x-original-url',
  'x-rewrite-url',
])

/**
 * Block vendor variants of headers that can change routing or method
 * semantics after the published-operation allowlist has already run.
 */
function isSemanticOverrideHeader(name: string): boolean {
  return (
    name.endsWith('-method-override') ||
    /^x-[a-z0-9-]*original-(?:method|path|uri|url)$/.test(name) ||
    /^x-[a-z0-9-]*rewrite-(?:path|uri|url)$/.test(name)
  )
}

interface TryItPayload {
  specId?: unknown
  operationPath?: unknown
  method?: unknown
  url?: unknown
  headers?: unknown
  body?: unknown
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function operationPathPattern(basePath: string, operationPath: string): RegExp {
  const joined = `${basePath.replace(/\/+$/, '')}/${operationPath.replace(/^\/+/, '')}` || '/'
  let source = ''
  let cursor = 0
  for (const match of joined.matchAll(/{[^/{}]+}/g)) {
    const index = match.index ?? 0
    source += escapeRegex(joined.slice(cursor, index))
    source += '[^/]+'
    cursor = index + match[0].length
  }
  source += escapeRegex(joined.slice(cursor))
  return new RegExp(`^${source}/?$`)
}

interface ResolvedAddress {
  address: string
  family: 4 | 6
}

function isGlobalAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address)
    return parsed.range() === 'unicast'
  } catch {
    return false
  }
}

function isPublicTarget(target: URL): boolean {
  const hostname = target.hostname.toLowerCase()
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.hash ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost')
  ) {
    return false
  }
  const literal = hostname.replace(/^\[|\]$/g, '')
  return !ipaddr.isValid(literal) || isGlobalAddress(literal)
}

async function resolvePublicAddresses(target: URL): Promise<Array<ResolvedAddress>> {
  const hostname = target.hostname.replace(/^\[|\]$/g, '')
  if (ipaddr.isValid(hostname)) {
    if (!isGlobalAddress(hostname)) throw new Error('private_target')
    return [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }]
  }
  const resolved = await lookup(hostname, { all: true, verbatim: true })
  if (
    resolved.length === 0 ||
    resolved.some(({ address }) => !isGlobalAddress(address))
  ) {
    throw new Error('private_target')
  }
  return resolved.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }))
}

function isCloudflareWorkerRuntime(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'
}

async function fetchPinnedToAddresses(
  target: URL,
  addresses: Array<ResolvedAddress>,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
): Promise<Response> {
  const transport = target.protocol === 'https:'
    ? await import('node:https')
    : await import('node:http')
  const { Readable } = await import('node:stream')

  return new Promise((resolve, reject) => {
    const requestOptions: import('node:http').RequestOptions & {
      autoSelectFamily: boolean
    } = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: init.method,
      headers: { ...init.headers, host: target.host },
      signal: init.signal,
      autoSelectFamily: true,
      lookup(_hostname, options, callback) {
        if (options.all) {
          callback(null, addresses)
          return
        }
        callback(null, addresses[0].address, addresses[0].family)
      },
      ...(target.protocol === 'https:' ? { servername: target.hostname } : {}),
    }
    const upstream = transport.request(requestOptions, (response) => {
      const status = response.statusCode ?? 502
      const headers = new Headers()
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) headers.append(name, item)
        } else if (value !== undefined) {
          headers.set(name, String(value))
        }
      }
      const hasNoBody = init.method === 'HEAD' || [204, 205, 304].includes(status)
      if (hasNoBody) response.destroy()
      resolve(new Response(
        hasNoBody ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>,
        { status, statusText: response.statusMessage ?? '', headers },
      ))
    })
    upstream.once('error', reject)
    if (init.body !== undefined) upstream.write(init.body)
    upstream.end()
  })
}

function isDeclaredOperationTarget(
  target: URL,
  operation: NormalizedOperation,
  requestOrigin: string,
): boolean {
  return operation.servers.some((server) => {
    let declared: URL
    try {
      declared = new URL(server.url, requestOrigin)
    } catch {
      return false
    }
    return (
      isPublicTarget(declared) &&
      declared.origin === target.origin &&
      operationPathPattern(declared.pathname, operation.path).test(target.pathname)
    )
  })
}

function normalizeHeaders(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const headers: Record<string, string> = {}
  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== 'string') return null
    const normalizedKey = key.trim().toLowerCase()
    if (
      !headerValue ||
      BLOCKED_HEADERS.has(normalizedKey) ||
      isSemanticOverrideHeader(normalizedKey)
    ) continue
    headers[key] = headerValue
  }
  return headers
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error('response_too_large')
  }
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Array<Uint8Array> = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('response_too_large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export async function POST(request: NextRequest) {
  let payload: TryItPayload
  try {
    payload = (await readBoundedJson(request, MAX_ENVELOPE_BYTES)) as TryItPayload
  } catch (error) {
    return jsonError(
      error instanceof SyntaxError ? 'Invalid JSON body' : 'Request is too large',
      error instanceof SyntaxError ? 400 : 413,
    )
  }
  if (!payload || typeof payload !== 'object') return jsonError('Invalid request body', 400)

  const method = typeof payload.method === 'string' ? payload.method.toUpperCase() : ''
  const operationPath = typeof payload.operationPath === 'string' ? payload.operationPath : ''
  const specId = typeof payload.specId === 'string' ? payload.specId : undefined
  if (!method || !operationPath || typeof payload.url !== 'string') {
    return jsonError('Missing operation identity or URL', 400)
  }
  if (!ALLOWED_METHODS.has(method)) return jsonError('Unsupported HTTP method', 400)
  if (
    typeof payload.body === 'string' &&
    Buffer.byteLength(payload.body, 'utf8') > MAX_UPSTREAM_BODY_BYTES
  ) {
    return jsonError('Request body is too large', 413)
  }

  let target: URL
  try {
    target = new URL(payload.url, request.nextUrl.origin)
  } catch {
    return jsonError('Invalid request URL', 400)
  }
  if (!isPublicTarget(target)) return jsonError('Private or unsafe targets are not allowed', 403)
  // Encoded path separators can be decoded by an upstream proxy after the
  // operation allowlist check, turning one documented parameter into another
  // route. Reject single and recursively encoded separators at this boundary.
  if (/%(?:2f|5c|25)/iu.test(target.pathname)) {
    return jsonError('Encoded path separators are not allowed', 403)
  }

  const operation = await getApiOperationByKey(method, operationPath, specId)
  if (
    !operation ||
    operation.operation.isWebhook ||
    !isDeclaredOperationTarget(target, operation.operation, request.nextUrl.origin)
  ) {
    return jsonError('Target does not match a published OpenAPI operation', 403)
  }
  const headers = normalizeHeaders(payload.headers)
  if (!headers) return jsonError('Invalid request headers', 400)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const startedAt = Date.now()
  try {
    // Cloudflare's `global_fetch_strictly_public` compatibility flag performs
    // connection-time address filtering and is declared in both the public
    // Wrangler config and managed release metadata. Node has no equivalent,
    // so self-hosted deployments resolve once and pin the validated address
    // set in Node's connector to close the DNS-rebinding window while retaining
    // IPv4/IPv6 fallback.
    const requestInit = {
      method,
      headers,
      body:
        shouldIncludeBody(method) && typeof payload.body === 'string'
          ? payload.body
          : undefined,
      signal: controller.signal,
    }
    const response = isCloudflareWorkerRuntime()
      ? await fetch(target, { ...requestInit, redirect: 'manual' })
      : await fetchPinnedToAddresses(
          target,
          await resolvePublicAddresses(target),
          requestInit,
        )
    const textBody = await readBoundedResponse(response)
    return NextResponse.json({
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: textBody,
      duration: Date.now() - startedAt,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'private_target') {
      return jsonError('Private or unsafe targets are not allowed', 403)
    }
    if (error instanceof Error && error.message === 'response_too_large') {
      return jsonError('Upstream response is too large', 502)
    }
    if (controller.signal.aborted) return jsonError('Upstream request timed out', 504)
    return jsonError('Upstream request failed', 502)
  } finally {
    clearTimeout(timeout)
  }
}

function shouldIncludeBody(method: string) {
  return !['GET', 'HEAD'].includes(method)
}
