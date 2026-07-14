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

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const cloud = await getCloudSiteConfig(request.nextUrl.origin)
  const cloudPasswordHash =
    cloud?.siteConfig.access.mode === 'password'
      ? cloud.siteConfig.access.passwordHash
      : null
  const enabled = Boolean(cloudPasswordHash) || isDocsAccessEnabled()

  if (!enabled) {
    return NextResponse.json({ error: 'Docs access protection is not enabled.' }, { status: 503 })
  }

  const body = (await request.json()) as { password?: string }
  const valid = Boolean(
    body.password &&
      (cloudPasswordHash
        ? verifyPasswordHash(body.password, cloudPasswordHash)
        : await verifyDocsAccessPasswordAsync(body.password)),
  )
  if (!valid) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const token = createDocsAccessToken()
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
