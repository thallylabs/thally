/**
 * GET /api/reader/oidc/callback — finish reader sign-in with the customer's
 * OpenID Connect provider.
 *
 * CSRF: the `state` parameter must match (constant-time) the value in the
 * signed, path-scoped flow cookie set by `/api/reader/login`; the flow cookie
 * is cleared on every outcome so a code can be redeemed at most once per flow.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { getReaderAuthConfig } from '@/lib/reader-auth/config'
import {
  READER_OIDC_CALLBACK_PATH,
  READER_OIDC_FLOW_COOKIE,
  completeReaderOidcFlow,
  getReaderOidcSettings,
  readerOidcFlowCookieOptions,
  safeEqual,
  verifyReaderOidcFlow,
} from '@/lib/reader-auth/oidc'
import { completeReaderSignIn, readerAuthFailure, readerCallbackOrigin } from '@/lib/reader-auth/routes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clearFlow(response: Response): Response {
  if (response instanceof NextResponse) {
    response.cookies.set(READER_OIDC_FLOW_COOKIE, '', { ...readerOidcFlowCookieOptions(), maxAge: 0 })
  } else {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
    response.headers.append('set-cookie', `${READER_OIDC_FLOW_COOKIE}=; Path=${READER_OIDC_CALLBACK_PATH}; Max-Age=0; HttpOnly; SameSite=Lax${secure}`)
  }
  return response
}

export async function GET(request: NextRequest): Promise<Response> {
  const config = getReaderAuthConfig()
  const settings = getReaderOidcSettings(config)
  if (!settings) return readerAuthFailure(request, 404, 'reader_oidc_disabled')

  const params = request.nextUrl.searchParams
  const code = params.get('code')
  const state = params.get('state')
  const flow = await verifyReaderOidcFlow(request.cookies.get(READER_OIDC_FLOW_COOKIE)?.value, request.nextUrl.host)
  if (!flow || !state || !safeEqual(state, flow.state)) return clearFlow(readerAuthFailure(request, 403, 'reader_oidc_state_mismatch'))
  // The provider reported an error (user cancelled, consent denied, …).
  if (!code || params.has('error')) return clearFlow(readerAuthFailure(request, 401, 'reader_oidc_denied'))

  let identity: Awaited<ReturnType<typeof completeReaderOidcFlow>>
  try {
    identity = await completeReaderOidcFlow(settings, {
      code,
      redirectUri: `${readerCallbackOrigin(request)}${READER_OIDC_CALLBACK_PATH}`,
      flow,
    })
  } catch {
    return clearFlow(readerAuthFailure(request, 401, 'reader_oidc_verification_failed'))
  }

  const response = await completeReaderSignIn(request, identity, flow.returnPath)
  return clearFlow(response ?? readerAuthFailure(request, 503, 'reader_session_secret_missing'))
}
