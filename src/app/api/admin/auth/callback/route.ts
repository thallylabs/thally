import { type NextRequest, NextResponse } from 'next/server'
import { getOidcConfig, exchangeAndVerify } from '@/lib/auth/oidc'
import { verifyShortLived, signSession, OIDC_FLOW_COOKIE } from '@/lib/auth/session'
import { SESSION_COOKIE } from '@/lib/auth/session'
import { resolveRoleFromRoster } from '@/lib/auth/roster'

export const runtime = 'nodejs'

/** OIDC callback: verify the ID token, match the roster, set the session cookie. */
export async function GET(request: NextRequest) {
  const config = getOidcConfig()
  const login = (err: string) => NextResponse.redirect(new URL(`/admin/login?error=${err}`, request.url))
  if (!config) return login('oidc_not_configured')

  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  if (!code || !state) return login('oidc_error')

  const flow = await verifyShortLived(request.cookies.get(OIDC_FLOW_COOKIE)?.value)
  if (!flow || flow.state !== state) return login('state_mismatch')

  let email: string
  try {
    const redirectUri = `${request.nextUrl.origin}/api/admin/auth/callback`
    const result = await exchangeAndVerify(config, {
      code,
      redirectUri,
      codeVerifier: flow.codeVerifier,
      nonce: flow.nonce,
    })
    email = result.email
  } catch {
    return login('oidc_verify_failed')
  }

  // Only sign in identities that the git-committed roster grants a role.
  const role = resolveRoleFromRoster(email)
  if (!role) return login('not_authorized')

  const session = await signSession({ email })
  if (!session) return login('no_secret')

  const res = NextResponse.redirect(new URL('/admin', request.url))
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  })
  res.cookies.delete(OIDC_FLOW_COOKIE)
  return res
}
