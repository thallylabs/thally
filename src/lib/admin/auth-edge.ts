const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const ADMIN_SESSION_COOKIE = 'thally_admin_session'
export const DOCS_ACCESS_COOKIE = 'thally_docs_access'

function getSecret(): string {
  return (process.env.THALLY_ADMIN_SECRET ?? process.env.DOX_ADMIN_SECRET) ?? (process.env.THALLY_ADMIN_PASSWORD ?? process.env.DOX_ADMIN_PASSWORD) ?? 'thally-dev-admin'
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signPayload(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return toBase64Url(new Uint8Array(signature))
}

async function verifySignedToken(token: string | undefined, scope?: string): Promise<boolean> {
  if (!token) return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false

  const expected = await signPayload(payload)
  if (expected !== signature) return false

  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const data = JSON.parse(json) as { exp?: number; scope?: string }
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return false
    if (scope && data.scope !== scope) return false
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

export function getInternalAnalyticsSecretEdge(): string {
  return (process.env.THALLY_ANALYTICS_SECRET ?? process.env.DOX_ANALYTICS_SECRET) ?? getSecret()
}

export async function isAdminAuthenticatedEdge(cookieValue: string | undefined): Promise<boolean> {
  // The password cookie is only valid when a password is actually configured.
  // (Gating on isAdminEnabledEdge — which is also true for OIDC-only — would let
  // a cookie forged with the public default HMAC secret pass when no password is
  // set but OIDC enables the admin gate.)
  if (!(process.env.THALLY_ADMIN_PASSWORD ?? process.env.DOX_ADMIN_PASSWORD)) return false
  return verifySignedToken(cookieValue)
}

export async function isDocsAccessGrantedEdge(cookieValue: string | undefined): Promise<boolean> {
  if (!isDocsAccessEnabledEdge()) return true
  return verifySignedToken(cookieValue, 'docs')
}

export { SESSION_TTL_MS, getSecret }
