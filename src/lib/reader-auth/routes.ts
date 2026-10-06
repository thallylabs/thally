/**
 * Shared plumbing for the reader sign-in route handlers (server-only).
 *
 * Every response here is `private, no-store` and `Referrer-Policy:
 * no-referrer`: sign-in URLs can carry one-time tokens or codes, and none of
 * them may be cached or leaked to the next page through the Referer header.
 * Failures are deliberately generic; the precise reason is never returned to
 * the browser or logged with token material.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { problemResponse } from '@/lib/http/problem'
import { resolveSafeReturnPath } from '@/lib/safe-return-path'
import { loadReferencedReaderGroups } from '@/data/docs'
import { READER_AUTH_LIMITS, getReaderAuthConfig } from './config'
import { readerSessionCookieName, readerSessionCookieOptions, signReaderSession } from './session'

export const READER_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
} as const

const MAX_FORM_BYTES = 48 * 1024

/**
 * The deployment's canonical origin when configured. Token audience binding
 * uses ONLY this when it is set: a request's Host header is client-controlled,
 * so trusting it would let a token minted for another site be accepted here.
 */
function configuredSiteOrigin(): string | null {
  const configured = process.env.THALLY_SITE_URL ?? process.env.DOX_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL
  if (!configured?.trim()) return null
  try {
    return new URL(configured.trim()).origin
  } catch {
    return null
  }
}

/**
 * Origins a handoff token may be bound to (see {@link configuredSiteOrigin}).
 * Production without a configured site URL binds to nothing, so only an
 * explicit `auth.jwt.audience` can be satisfied there: falling back to the
 * Host header would let a token minted for another site be replayed here.
 */
export function readerSiteOrigins(request: NextRequest): Array<string> {
  const configured = configuredSiteOrigin()
  if (configured) return [configured]
  return process.env.NODE_ENV === 'production' ? [] : [request.nextUrl.origin]
}

/** Origin used to build the OIDC redirect URI. */
export function readerCallbackOrigin(request: NextRequest): string {
  return configuredSiteOrigin() ?? request.nextUrl.origin
}

/** Validate a requested return path; anything off-site becomes `/`. */
export function readerReturnPath(value: string | null | undefined): string {
  const path = resolveSafeReturnPath(value ?? null, '/')
  // Never bounce back into the sign-in machinery itself.
  return path.startsWith('/api/reader/') || path.startsWith('/login/jwt-callback') ? '/' : path
}

/** Generic sign-in failure. */
export function readerAuthFailure(request: NextRequest, status: 400 | 401 | 403 | 404 | 503 | 502, code: string): Response {
  const titles: Record<number, string> = {
    400: 'Invalid sign-in request',
    401: 'Sign-in failed',
    403: 'Sign-in request rejected',
    404: 'Not found',
    502: 'Identity provider unavailable',
    503: 'Reader sign-in is not configured',
  }
  return problemResponse({
    status,
    code,
    title: titles[status],
    detail: status === 401 ? 'The sign-in credential was not accepted.' : titles[status],
    resolution: status === 503
      ? 'The site owner must finish configuring reader authentication.'
      : 'Return to the sign-in page and try again.',
    instance: request.nextUrl.pathname,
    headers: READER_NO_STORE_HEADERS,
  })
}

/**
 * Issue the reader session cookie and redirect (303) to a validated return
 * path. Only groups the site's content references are kept, so readers from
 * large directories still fit in a cookie; a group newly referenced by
 * content applies from the reader's next sign-in. Returns null when sessions
 * cannot be signed (no secret configured).
 */
export async function completeReaderSignIn(
  request: NextRequest,
  identity: { subject?: string; groups: ReadonlyArray<string>; expiresAt?: number },
  returnPath: string,
): Promise<Response | null> {
  const referenced = await loadReferencedReaderGroups()
  const groups = identity.groups.filter((group) => referenced.has(group))
  const session = await signReaderSession({ ...identity, groups }, getReaderAuthConfig(), request.nextUrl.host)
  if (!session) return null
  // Browsers silently drop oversized cookies, which would loop the reader
  // through sign-in; refuse clearly instead.
  if (session.token.length > READER_AUTH_LIMITS.maxCredentialLength) return readerAuthFailure(request, 400, 'reader_groups_too_large')
  const response = NextResponse.redirect(new URL(readerReturnPath(returnPath), request.nextUrl.origin), 303)
  for (const [name, value] of Object.entries(READER_NO_STORE_HEADERS)) response.headers.set(name, value)
  response.cookies.set(readerSessionCookieName(), session.token, readerSessionCookieOptions(session.maxAgeSeconds))
  return response
}

/** Read a small request body as text, refusing anything over the budget. */
export async function readBoundedText(request: Request, maxBytes = MAX_FORM_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Array<Uint8Array> = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maxBytes) {
      await reader.cancel()
      return null
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
