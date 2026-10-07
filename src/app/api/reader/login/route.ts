/**
 * GET /api/reader/login?redirect=/path — start reader sign-in.
 *
 * The only place that sends a browser off-site for reader authentication:
 * - `jwt` mode → the customer's `auth.loginUrl`, with `redirect=<path>` so the
 *   customer app can hand the reader back to the page they wanted;
 * - `oidc` mode → the identity provider's authorization endpoint (PKCE).
 * Documents and App Router payloads only ever redirect here (same origin).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { getReaderAuthConfig } from '@/lib/reader-auth/config'
import { getReaderOidcSettings, readerOidcFlowCookieOptions, startReaderOidcFlow, READER_OIDC_CALLBACK_PATH, READER_OIDC_FLOW_COOKIE } from '@/lib/reader-auth/oidc'
import { READER_NO_STORE_HEADERS, readerAuthFailure, readerCallbackOrigin, readerReturnPath } from '@/lib/reader-auth/routes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  const config = getReaderAuthConfig()
  if (!config.isEnabled) return readerAuthFailure(request, 404, 'reader_auth_disabled')
  const returnPath = readerReturnPath(request.nextUrl.searchParams.get('redirect'))

  if (config.mode === 'jwt') {
    if (!config.loginUrl) return readerAuthFailure(request, 503, 'reader_login_url_missing')
    const target = new URL(config.loginUrl)
    target.searchParams.set('redirect', returnPath)
    const response = NextResponse.redirect(target, 302)
    for (const [name, value] of Object.entries(READER_NO_STORE_HEADERS)) response.headers.set(name, value)
    return response
  }

  const settings = getReaderOidcSettings(config)
  if (!settings) return readerAuthFailure(request, 503, 'reader_oidc_not_configured')
  let started: Awaited<ReturnType<typeof startReaderOidcFlow>>
  try {
    started = await startReaderOidcFlow(settings, `${readerCallbackOrigin(request)}${READER_OIDC_CALLBACK_PATH}`, returnPath)
  } catch {
    return readerAuthFailure(request, 502, 'reader_oidc_discovery_failed')
  }
  if (!started) return readerAuthFailure(request, 503, 'reader_session_secret_missing')
  const response = NextResponse.redirect(started.url, 302)
  for (const [name, value] of Object.entries(READER_NO_STORE_HEADERS)) response.headers.set(name, value)
  response.cookies.set(READER_OIDC_FLOW_COOKIE, started.flowCookie, readerOidcFlowCookieOptions())
  return response
}
