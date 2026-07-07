import { NextResponse } from 'next/server'
import { type NextRequest } from 'next/server'
import {
  DOCS_ACCESS_COOKIE,
  createDocsAccessToken,
  isDocsAccessEnabled,
  verifyDocsAccessPasswordAsync,
} from '@/lib/admin/auth'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!isDocsAccessEnabled()) {
    return NextResponse.json({ error: 'Docs access protection is not enabled.' }, { status: 503 })
  }

  const body = (await request.json()) as { password?: string }
  if (!body.password || !(await verifyDocsAccessPasswordAsync(body.password))) {
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
