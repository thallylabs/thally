import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  DOCS_ACCESS_COOKIE,
  SESSION_TTL_MS,
  getSecret,
} from '@/lib/admin/auth-edge'

export { ADMIN_SESSION_COOKIE, DOCS_ACCESS_COOKIE }

function getAdminPassword(): string | null {
  return (process.env.THALLY_ADMIN_PASSWORD ?? process.env.DOX_ADMIN_PASSWORD) ?? null
}

export function isAdminEnabled(): boolean {
  return Boolean(getAdminPassword())
}

export function verifyAdminPassword(password: string): boolean {
  const expected = getAdminPassword()
  if (!expected) return false

  const a = Buffer.from(password)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function signPayloadNode(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

export function createAdminSessionToken(): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + SESSION_TTL_MS }),
  ).toString('base64url')
  return `${payload}.${signPayloadNode(payload)}`
}

function verifySignedTokenNode(token: string | undefined, scope?: string): boolean {
  if (!token) return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false

  const expected = signPayloadNode(payload)
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return false

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number; scope?: string }
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return false
    if (scope && data.scope !== scope) return false
    return true
  } catch {
    return false
  }
}

export function verifyAdminSessionToken(token: string | undefined): boolean {
  return verifySignedTokenNode(token)
}

export function isAdminAuthenticated(request: NextRequest): boolean {
  if (!isAdminEnabled()) return false
  return verifyAdminSessionToken(request.cookies.get(ADMIN_SESSION_COOKIE)?.value)
}

export function getDocsAccessPassword(): string | null {
  return (process.env.THALLY_ACCESS_PASSWORD ?? process.env.DOX_ACCESS_PASSWORD) ?? null
}

export function isDocsAccessEnabled(): boolean {
  return Boolean(getDocsAccessPassword())
}

export function verifyDocsAccessPassword(password: string): boolean {
  const expected = getDocsAccessPassword()
  if (!expected) return false

  const a = Buffer.from(password)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Verify the docs-access password with the admin override applied: a
 * dashboard-set password (F1, hashed) WINS; otherwise fall back to the
 * THALLY_ACCESS_PASSWORD env value. (Env presence remains the enable signal that
 * the edge gate reads — it can't reach F1.)
 */
export async function verifyDocsAccessPasswordAsync(password: string): Promise<boolean> {
  const { getAdminSettings } = await import('@/lib/admin/settings')
  const { verifyPasswordHash } = await import('@/lib/admin/secrets')
  const { docsPasswordHash } = await getAdminSettings()
  if (docsPasswordHash) return verifyPasswordHash(password, docsPasswordHash)
  return verifyDocsAccessPassword(password)
}

export function createDocsAccessToken(): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + SESSION_TTL_MS, scope: 'docs' }),
  ).toString('base64url')
  return `${payload}.${signPayloadNode(payload)}`
}

export function verifyDocsAccessToken(token: string | undefined): boolean {
  if (!isDocsAccessEnabled()) return true
  return verifySignedTokenNode(token, 'docs')
}

export function getInternalAnalyticsSecret(): string {
  return (process.env.THALLY_ANALYTICS_SECRET ?? process.env.DOX_ANALYTICS_SECRET) ?? getSecret()
}
