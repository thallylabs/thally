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
import { reserveAuthAttempt, resetAuthAttempts } from '@/lib/admin/auth-rate-limit'
import { BODY_TOO_LARGE_ERROR, readBoundedJson } from '@/lib/http/bounded-json'

export const runtime = 'nodejs'
const MAX_AUTH_BODY_BYTES = 8 * 1024

export async function POST(request: NextRequest) {
  const attempt = reserveAuthAttempt('admin', request.headers)
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      {
        status: 429,
        headers: {
          'Cache-Control': 'private, no-store',
          'Retry-After': String(attempt.retryAfter),
        },
      },
    )
  }

  let body: unknown
  try {
    body = await readBoundedJson(request, MAX_AUTH_BODY_BYTES)
  } catch (error) {
    const isTooLarge = error instanceof Error && error.message === BODY_TOO_LARGE_ERROR
    return NextResponse.json(
      { error: isTooLarge ? 'Request is too large.' : 'Invalid JSON body.' },
      { status: isTooLarge ? 413 : 400, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  if (!isAdminEnabled()) {
    resetAuthAttempts(attempt.key)
    return NextResponse.json(
      { error: 'Admin dashboard is not configured. Set THALLY_ADMIN_PASSWORD.' },
      { status: 503 },
    )
  }

  const password =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { password?: unknown }).password
      : undefined
  if (typeof password !== 'string' || !password || !verifyAdminPassword(password)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const token = createAdminSessionToken()
  if (!token) {
    resetAuthAttempts(attempt.key)
    return NextResponse.json(
      { error: 'Admin session signing is not configured.' },
      { status: 503 },
    )
  }
  resetAuthAttempts(attempt.key)
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
  // left thally_admin_id valid until its 8h expiry (a non-terminable session).
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
