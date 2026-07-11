import { SignJWT, jwtVerify } from 'jose'

/** Cookie holding the OIDC identity session (distinct from the break-glass
 * password session cookie `thally_admin_session`). */
export const SESSION_COOKIE = 'thally_admin_id'

const TTL_SECONDS = 60 * 60 * 8 // 8 hours

/**
 * The session-signing key. The one legitimately-required env var for team auth
 * (it's a secret, not a database). Returns null when unset/too short, so auth is
 * simply unavailable rather than insecure.
 */
function secretKey(): Uint8Array | null {
  const secret = (process.env.THALLY_AUTH_SECRET ?? process.env.DOX_AUTH_SECRET)?.trim()
  if (!secret || secret.length < 16) return null
  return new TextEncoder().encode(secret)
}

export interface SessionPayload {
  /** Verified identity only — the ROLE is looked up live, never trusted from here. */
  email: string
}

export async function signSession(payload: SessionPayload): Promise<string | null> {
  const key = secretKey()
  if (!key) return null
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key)
}

/** Verify a session cookie's signature + expiry. Edge-safe (Web Crypto via jose). */
export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  const key = secretKey()
  if (!key || !token) return null
  try {
    const { payload } = await jwtVerify(token, key)
    return typeof payload.email === 'string' ? { email: payload.email } : null
  } catch {
    return null
  }
}

/** Cookie holding the in-flight OIDC state/nonce/PKCE verifier. */
export const OIDC_FLOW_COOKIE = 'thally_oidc_flow'

/** Sign a short-lived payload (the OIDC flow cookie). */
export async function signShortLived(data: Record<string, string>, ttlSeconds: number): Promise<string | null> {
  const key = secretKey()
  if (!key) return null
  return new SignJWT(data).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${ttlSeconds}s`).sign(key)
}

export async function verifyShortLived(token: string | undefined): Promise<Record<string, string> | null> {
  const key = secretKey()
  if (!key || !token) return null
  try {
    const { payload } = await jwtVerify(token, key)
    return payload as Record<string, string>
  } catch {
    return null
  }
}
