/**
 * Request-scoped reader identity (server-only).
 *
 * The one place that turns an incoming request into a {@link ReaderContext}:
 * an `Authorization: Bearer thrt_…` agent token, else the reader session
 * cookie, else anonymous. Route handlers that already hold the request use
 * {@link getReaderContextFromRequest}; server components use
 * {@link getReaderContext}, which reads `next/headers`.
 *
 * Static-rendering contract: when reader auth is not active this returns the
 * anonymous reader WITHOUT touching `cookies()` or `headers()`, so public sites
 * keep their static prerendering. When it is active, reading request data is
 * exactly what makes Next render the route per request, which is required:
 * a reader-specific page must never be prerendered or shared.
 */

import 'server-only'

import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { getReaderAuthConfig, isReaderAuthActive, type ReaderAuthConfig } from './config'
import { ANONYMOUS_READER, type ReaderContext } from './access'
import { bearerFromAuthorization, readerSessionCookieName, verifyAgentToken, verifyReaderSession } from './session'

/**
 * Resolve a reader from raw credentials. A presented bearer token is
 * authoritative: an invalid one yields anonymous rather than falling back to
 * a cookie, so an agent never silently acts with a browser's session.
 */
export async function resolveReader(
  authorization: string | null | undefined,
  sessionCookie: string | null | undefined,
  config: ReaderAuthConfig = getReaderAuthConfig(),
): Promise<ReaderContext> {
  if (!config.isEnabled) return ANONYMOUS_READER
  const bearer = bearerFromAuthorization(authorization)
  if (bearer) return (await verifyAgentToken(bearer, config)) ?? ANONYMOUS_READER
  return (await verifyReaderSession(sessionCookie)) ?? ANONYMOUS_READER
}

/**
 * Reader for a route handler. This is the hook MCP and other API routes call:
 * `const reader = await getReaderContextFromRequest(request)` and pass it to
 * the reader-aware loaders in `@/data/docs`.
 */
export async function getReaderContextFromRequest(request: Request): Promise<ReaderContext> {
  const config = getReaderAuthConfig()
  if (!isReaderAuthActive(config)) return ANONYMOUS_READER
  const cookieName = readerSessionCookieName()
  const cookieHeader = request.headers.get('cookie') ?? ''
  const sessionCookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1)
  return resolveReader(request.headers.get('authorization'), sessionCookie, config)
}

/**
 * Reader for server components and metadata, memoized per render. Calling it
 * on a site with reader auth active opts the route into dynamic rendering.
 */
export const getReaderContext = cache(async (): Promise<ReaderContext> => {
  const config = getReaderAuthConfig()
  if (!isReaderAuthActive(config)) return ANONYMOUS_READER
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()])
  return resolveReader(headerStore.get('authorization'), cookieStore.get(readerSessionCookieName())?.value, config)
})
