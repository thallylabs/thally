import { NextResponse } from 'next/server'
import { type NextRequest } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  isAdminEnabled,
  verifyAdminPassword,
} from '@/lib/admin/auth'
import { SESSION_COOKIE } from '@/lib/auth/session'
import { resolveAdminFromRequest } from '@/lib/auth/rbac'
import { getOidcConfig } from '@/lib/auth/oidc'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!isAdminEnabled()) {
    return NextResponse.json(
      { error: 'Admin dashboard is not configured. Set DOX_ADMIN_PASSWORD.' },
      { status: 503 },
    )
  }

  const body = (await request.json()) as { password?: string }
  if (!body.password || !verifyAdminPassword(body.password)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const token = createAdminSessionToken()
  const response = NextResponse.json({ ok: true })
  response.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  })
  return response
}

export async function DELETE() {
  // Logout is idempotent and always allowed. Clear BOTH the break-glass password
  // session and the OIDC identity session — the old handler 401'd OIDC admins and
  // left dox_admin_id valid until its 8h expiry (a non-terminable session).
  const response = NextResponse.json({ ok: true })
  const expire = { httpOnly: true as const, path: '/', maxAge: 0 }
  response.cookies.set(ADMIN_SESSION_COOKIE, '', expire)
  response.cookies.set(SESSION_COOKIE, '', expire)
  return response
}

export async function GET(request: NextRequest) {
  const session = await resolveAdminFromRequest(request)
  return NextResponse.json({
    authenticated: Boolean(session),
    enabled: isAdminEnabled() || Boolean(getOidcConfig()),
  })
}
