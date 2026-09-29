const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const ADMIN_SESSION_COOKIE = 'thally_admin_session'
export const DOCS_ACCESS_COOKIE = 'thally_docs_access'

function getAdminSigningSecret(): string | null {
  const configured = [process.env.THALLY_ADMIN_SECRET, process.env.DOX_ADMIN_SECRET].find(
    (value) => Boolean(value?.trim()),
  )
  if (configured) return configured

  // A stable development key keeps zero-config local previews usable. It must
  // never become a production signing key: its value is public source code.
  return process.env.NODE_ENV === 'production' ? null : 'thally-dev-admin'
}

function getDocsSigningSecret(): string | null {
  return [
    process.env.THALLY_ACCESS_SECRET,
    process.env.DOX_ACCESS_SECRET,
    process.env.THALLY_ADMIN_SECRET,
    process.env.DOX_ADMIN_SECRET,
  ].find((value) => Boolean(value?.trim())) ??
    (process.env.NODE_ENV === 'production' ? null : 'thally-dev-docs')
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signPayload(payload: string, secret: string | null): Promise<string | null> {
  if (!secret) return null
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return toBase64Url(new Uint8Array(signature))
}

async function verifySignedToken(
  token: string | undefined,
  secret: string | null,
  scope: 'admin' | 'docs',
): Promise<boolean> {
  if (!token) return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false

  const expected = await signPayload(payload, secret)
  if (!expected) return false
  if (expected !== signature) return false

  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const data = JSON.parse(json) as { exp?: number; scope?: string }
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return false
    if (data.scope !== scope) return false
    return true
  } catch {
    return false
  }
}

export function isOidcConfiguredEdge(): boolean {
  return Boolean((process.env.THALLY_OIDC_ISSUER ?? process.env.DOX_OIDC_ISSUER) && (process.env.THALLY_OIDC_CLIENT_ID ?? process.env.DOX_OIDC_CLIENT_ID))
}

export function isAdminEnabledEdge(): boolean {
  // Gate /admin when EITHER a break-glass password OR OIDC sign-in is configured.
  return Boolean((process.env.THALLY_ADMIN_PASSWORD ?? process.env.DOX_ADMIN_PASSWORD)) || isOidcConfiguredEdge()
}

export function isDocsAccessEnabledEdge(): boolean {
  return Boolean((process.env.THALLY_ACCESS_PASSWORD ?? process.env.DOX_ACCESS_PASSWORD))
}

export async function getInternalAnalyticsSecretEdge(): Promise<string | null> {
  const explicit = [
    process.env.THALLY_ANALYTICS_SECRET,
    process.env.DOX_ANALYTICS_SECRET,
  ].find((value) => Boolean(value?.trim())) ?? null
  if (explicit) return explicit

  const root = getAdminSigningSecret()
  if (!root) return null
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(root),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode('thally-analytics-v1'),
  )
  return toBase64Url(new Uint8Array(signature))
}

export async function isAdminAuthenticatedEdge(cookieValue: string | undefined): Promise<boolean> {
  // The password cookie is only valid when a password is actually configured.
  // (Gating on isAdminEnabledEdge — which is also true for OIDC-only — would let
  // a cookie forged with the public default HMAC secret pass when no password is
  // set but OIDC enables the admin gate.)
  if (!(process.env.THALLY_ADMIN_PASSWORD ?? process.env.DOX_ADMIN_PASSWORD)) return false
  return verifySignedToken(cookieValue, getAdminSigningSecret(), 'admin')
}

export async function isDocsAccessGrantedEdge(
  cookieValue: string | undefined,
  accessEnabled = isDocsAccessEnabledEdge(),
): Promise<boolean> {
  if (!accessEnabled) return true
  return verifySignedToken(cookieValue, getDocsSigningSecret(), 'docs')
}

export { SESSION_TTL_MS, getAdminSigningSecret, getDocsSigningSecret }
