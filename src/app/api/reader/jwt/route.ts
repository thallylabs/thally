/**
 * JWT handoff: exchange a customer-signed JWT for a Thally reader session.
 *
 * Accepted forms, most to least preferred:
 * 1. `/login/jwt-callback#<jwt>` (Mintlify-compatible) — the token stays in
 *    the URL fragment, which browsers never send to servers or in Referer;
 *    that page POSTs it here as JSON.
 * 2. `POST /api/reader/jwt` as a form (`token`, `redirect`) from the
 *    customer's app — an auto-submitting form keeps the token out of URLs.
 * 3. `GET /api/reader/jwt?token=<jwt>&redirect=/path` — supported for
 *    simple integrations. The token is verified, then a 303 strips it from the
 *    address bar; responses are `no-store` with `Referrer-Policy: no-referrer`.
 *
 * Login CSRF: a cross-site POST is accepted only from this site's origin or
 * the configured login URL's origin. Tokens are short-lived, bound to this
 * site by audience, and single-use per instance (`jti`).
 */

import { type NextRequest } from 'next/server'
import { getReaderAuthConfig } from '@/lib/reader-auth/config'
import { verifyHandoffToken } from '@/lib/reader-auth/handoff'
import { completeReaderSignIn, readBoundedText, readerAuthFailure, readerSiteOrigins } from '@/lib/reader-auth/routes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function exchange(request: NextRequest, token: string | null, redirect: string | null): Promise<Response> {
  const config = getReaderAuthConfig()
  if (!config.isEnabled || config.mode !== 'jwt') return readerAuthFailure(request, 404, 'reader_jwt_disabled')
  if (!token) return readerAuthFailure(request, 400, 'reader_token_missing')
  const result = await verifyHandoffToken(token, readerSiteOrigins(request), config)
  if (!result.isValid) {
    if (result.reason === 'not_configured' || result.reason === 'misconfigured') {
      return readerAuthFailure(request, 503, 'reader_jwt_key_not_configured')
    }
    return readerAuthFailure(request, 401, 'reader_token_rejected')
  }
  const response = await completeReaderSignIn(request, result, redirect ?? '/')
  return response ?? readerAuthFailure(request, 503, 'reader_session_secret_missing')
}

/** Origins allowed to POST a handoff: this site and the customer's login app. */
function isAllowedPostOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  // Non-browser clients send no Origin; login CSRF needs a browser, which always does on POST.
  if (origin === null) return true
  const allowed = new Set([request.nextUrl.origin, ...readerSiteOrigins(request)])
  const loginUrl = getReaderAuthConfig().loginUrl
  if (loginUrl) allowed.add(new URL(loginUrl).origin)
  return allowed.has(origin)
}

export async function GET(request: NextRequest): Promise<Response> {
  return exchange(request, request.nextUrl.searchParams.get('token'), request.nextUrl.searchParams.get('redirect'))
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isAllowedPostOrigin(request)) return readerAuthFailure(request, 403, 'reader_origin_rejected')
  const body = await readBoundedText(request)
  if (body === null) return readerAuthFailure(request, 400, 'reader_body_too_large')
  const contentType = request.headers.get('content-type') ?? ''
  let token: string | null = null
  let redirect: string | null = null
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(body) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const fields = parsed as { token?: unknown; redirect?: unknown }
        token = typeof fields.token === 'string' ? fields.token : null
        redirect = typeof fields.redirect === 'string' ? fields.redirect : null
      }
    } catch {
      return readerAuthFailure(request, 400, 'reader_body_invalid')
    }
  } else {
    const form = new URLSearchParams(body)
    token = form.get('token')
    redirect = form.get('redirect')
  }
  const response = await exchange(request, token, redirect)
  // The fragment page fetches this endpoint; give it the destination as data
  // instead of a redirect it would have to follow.
  if (contentType.includes('application/json') && response.status === 303) {
    const location = response.headers.get('location') ?? '/'
    const json = Response.json({ redirect: new URL(location).pathname + new URL(location).search + new URL(location).hash }, { headers: response.headers })
    json.headers.delete('location')
    return json
  }
  return response
}
