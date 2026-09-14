import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  DOCS_ACCESS_COOKIE,
  SESSION_TTL_MS,
  getAdminSigningSecret,
  getDocsSigningSecret,
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

function signPayloadNode(payload: string, secret: string | null): string | null {
  return secret
    ? createHmac('sha256', secret).update(payload).digest('base64url')
    : null
}

export function createAdminSessionToken(): string | null {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + SESSION_TTL_MS, scope: 'admin' }),
  ).toString('base64url')
  const signature = signPayloadNode(payload, getAdminSigningSecret())
  return signature ? `${payload}.${signature}` : null
}

function verifySignedTokenNode(
  token: string | undefined,
  secret: string | null,
  scope: 'admin' | 'docs',
): boolean {
  if (!token) return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false

  const expected = signPayloadNode(payload, secret)
  if (!expected) return false
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return false

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number; scope?: string }
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return false
    if (data.scope !== scope) return false
    return true
  } catch {
    return false
  }
}

export function verifyAdminSessionToken(token: string | undefined): boolean {
  return verifySignedTokenNode(token, getAdminSigningSecret(), 'admin')
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

export function createDocsAccessToken(): string | null {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + SESSION_TTL_MS, scope: 'docs' }),
  ).toString('base64url')
  const signature = signPayloadNode(payload, getDocsSigningSecret())
  return signature ? `${payload}.${signature}` : null
}

export function verifyDocsAccessToken(token: string | undefined): boolean {
  if (!isDocsAccessEnabled()) return true
  return verifySignedTokenNode(token, getDocsSigningSecret(), 'docs')
}

export function getInternalAnalyticsSecret(): string | null {
  const explicit = [
    process.env.THALLY_ANALYTICS_SECRET,
    process.env.DOX_ANALYTICS_SECRET,
  ].find((value) => Boolean(value?.trim())) ?? null
  if (explicit) return explicit
  const root = getAdminSigningSecret()
  return root
    ? createHmac('sha256', root).update('thally-analytics-v1').digest('base64url')
    : null
}
