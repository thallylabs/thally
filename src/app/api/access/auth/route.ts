import { NextResponse } from 'next/server'
import { type NextRequest } from 'next/server'
import {
  DOCS_ACCESS_COOKIE,
  createDocsAccessToken,
  isDocsAccessEnabled,
  verifyDocsAccessPasswordAsync,
} from '@/lib/admin/auth'
import { verifyPasswordHash } from '@/lib/admin/secrets'
import { getCloudSiteConfig } from '@/lib/cloud-link/client'
import { reserveAuthAttempt, resetAuthAttempts } from '@/lib/admin/auth-rate-limit'
import { BODY_TOO_LARGE_ERROR, readBoundedJson } from '@/lib/http/bounded-json'

export const runtime = 'nodejs'
const MAX_AUTH_BODY_BYTES = 8 * 1024

export async function POST(request: NextRequest) {
  const attempt = reserveAuthAttempt('docs', request.headers)
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

  const cloud = await getCloudSiteConfig(request.nextUrl.origin)
  const cloudPasswordHash =
    cloud?.siteConfig.access.mode === 'password'
      ? cloud.siteConfig.access.passwordHash
      : null
  const enabled = Boolean(cloudPasswordHash) || isDocsAccessEnabled()

  if (!enabled) {
    resetAuthAttempts(attempt.key)
    return NextResponse.json({ error: 'Docs access protection is not enabled.' }, { status: 503 })
  }

  const password =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { password?: unknown }).password
      : undefined
  const valid = Boolean(
    typeof password === 'string' &&
      password &&
      (cloudPasswordHash
        ? verifyPasswordHash(password, cloudPasswordHash)
        : await verifyDocsAccessPasswordAsync(password)),
  )
  if (!valid) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const token = createDocsAccessToken()
  if (!token) {
    resetAuthAttempts(attempt.key)
    return NextResponse.json(
      { error: 'Docs access session signing is not configured.' },
      { status: 503 },
    )
  }
  resetAuthAttempts(attempt.key)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(DOCS_ACCESS_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  })
  return response
}
