/**
 * /api/reader/logout — end the reader session.
 *
 * POST is the primary form (a sign-out button). GET is accepted for plain
 * links; logging a reader out is the only effect, so it needs no CSRF token.
 * Afterwards the reader goes to `auth.logoutUrl` (to end the session at the
 * customer's app or IdP too) or back to the site root.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { getReaderAuthConfig } from '@/lib/reader-auth/config'
import { readerSessionCookieName, readerSessionCookieOptions } from '@/lib/reader-auth/session'
import { READER_NO_STORE_HEADERS } from '@/lib/reader-auth/routes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function signOut(request: NextRequest): Response {
  const config = getReaderAuthConfig()
  const target = config.logoutUrl ? new URL(config.logoutUrl) : new URL('/', request.nextUrl.origin)
  const response = NextResponse.redirect(target, 303)
  for (const [name, value] of Object.entries(READER_NO_STORE_HEADERS)) response.headers.set(name, value)
  response.cookies.set(readerSessionCookieName(), '', { ...readerSessionCookieOptions(0), maxAge: 0 })
  return response
}

export async function GET(request: NextRequest): Promise<Response> {
  return signOut(request)
}

export async function POST(request: NextRequest): Promise<Response> {
  return signOut(request)
}
