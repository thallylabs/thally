import { type NextRequest, NextResponse } from 'next/server'
import { getOidcConfig, buildAuthorizeUrl } from '@/lib/auth/oidc'
import { signShortLived, OIDC_FLOW_COOKIE } from '@/lib/auth/session'

export const runtime = 'nodejs'

/** Start the OIDC sign-in: build the authorize URL (PKCE/state/nonce) and redirect. */
export async function GET(request: NextRequest) {
  const config = getOidcConfig()
  const login = (err: string) => NextResponse.redirect(new URL(`/admin/login?error=${err}`, request.url))
  if (!config) return login('oidc_not_configured')

  try {
    const redirectUri = `${request.nextUrl.origin}/api/admin/auth/callback`
    const auth = await buildAuthorizeUrl(config, redirectUri)
    const flow = await signShortLived(
      { state: auth.state, nonce: auth.nonce, codeVerifier: auth.codeVerifier },
      600,
    )
    if (!flow) return login('no_secret')

    const res = NextResponse.redirect(auth.url)
    res.cookies.set(OIDC_FLOW_COOKIE, flow, {
      httpOnly: true,
      secure: request.nextUrl.protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    })
    return res
  } catch {
    return login('oidc_error')
  }
}
