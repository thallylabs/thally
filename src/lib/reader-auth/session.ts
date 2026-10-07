/**
 * Reader sessions and scoped agent tokens (edge-safe: jose + Web Crypto only).
 *
 * Two credential types prove a reader's identity to this site:
 *
 * - **Reader session cookie** — issued by Thally after a verified JWT handoff
 *   or OIDC login. HS256 with `THALLY_READER_SESSION_SECRET`, short-lived,
 *   HttpOnly, SameSite=Lax, Secure (and `__Host-` prefixed) in production.
 * - **Agent token** — a read-only, group-scoped bearer credential for agents
 *   and MCP clients: `thrt_<JWT>`, HS256 under a key from
 *   `THALLY_READER_TOKEN_KEYS` selected by `kid`. Revocable by listing its
 *   `jti` or its `kid` in docs.json `auth.tokens.revoked`, or by removing the
 *   key from the environment. Accepted only from the `Authorization` header,
 *   never from a query string, and never converted into a cookie.
 *
 * Both are deliberately incompatible with admin credentials: distinct
 * issuers, audiences and `typ` headers, no `email` claim (which the admin
 * verifier requires), and a secret that is refused when it equals an admin
 * secret. Every verification pins `algorithms: ['HS256']`, so neither `none`
 * nor an asymmetric algorithm can be substituted.
 */

import { SignJWT, jwtVerify, decodeProtectedHeader } from 'jose'
import { READER_AUTH_ENV, READER_AUTH_LIMITS, getReaderAuthConfig, readReaderEnv, type ReaderAuthConfig } from './config'
import { normalizeGroupsClaim, type ReaderContext } from './access'

const ISSUER = 'thally-reader'
const SESSION_AUDIENCE = 'thally-reader-session'
const SESSION_TYPE = 'thally-reader-session+jwt'
const TOKEN_AUDIENCE = 'thally-reader-token'
const TOKEN_TYPE = 'thally-reader-token+jwt'
/** Visible prefix so secret scanners and humans can recognize agent tokens. */
export const AGENT_TOKEN_PREFIX = 'thrt_'
export const AGENT_TOKEN_SCOPE = 'docs:read'
const MIN_SECRET_LENGTH = 32
/** Sessions carry their own exp; this is only a tolerance for clock drift between instances. */
const SESSION_CLOCK_TOLERANCE_SECONDS = 5

/** Cookie name; `__Host-` binds it to this exact origin over HTTPS in production. */
export function readerSessionCookieName(): string {
  return process.env.NODE_ENV === 'production' ? '__Host-thally_reader' : 'thally_reader'
}

/** Attributes for the reader session cookie. */
export function readerSessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

let hasWarnedSharedSecret = false

/** Secrets that belong to other subsystems and must never sign reader credentials. */
function foreignSecrets(): Array<string> {
  return [
    process.env.THALLY_AUTH_SECRET,
    process.env.DOX_AUTH_SECRET,
    process.env.THALLY_ADMIN_SECRET,
    process.env.DOX_ADMIN_SECRET,
    process.env.THALLY_ACCESS_SECRET,
    process.env.DOX_ACCESS_SECRET,
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value))
}

const DEV_SESSION_KEY_OPT_IN = ['THALLY_READER_ALLOW_DEV_SESSION_KEY', 'DOX_READER_ALLOW_DEV_SESSION_KEY']

/**
 * The reader-session signing key, or null when reader sessions cannot be
 * issued safely. A dedicated ≥32-character secret is required, except that
 * a local preview may opt in to a fixed development key with
 * THALLY_READER_ALLOW_DEV_SESSION_KEY=1 (ignored when NODE_ENV is
 * `production`). That key is PUBLIC source code: with the opt-in set, anyone
 * who can reach the server can forge a session with any groups. The request's
 * Host header cannot limit this (clients choose it), so the opt-in must never
 * be set on a server reachable by anyone else.
 */
export function getReaderSessionKey(): Uint8Array | null {
  const configured = readReaderEnv(READER_AUTH_ENV.sessionSecret)
  if (configured) {
    if (configured.length < MIN_SECRET_LENGTH) return null
    if (foreignSecrets().includes(configured)) {
      if (!hasWarnedSharedSecret) {
        hasWarnedSharedSecret = true
        console.warn(`${READER_AUTH_ENV.sessionSecret} must differ from the admin and access secrets; reader sign-in is disabled.`)
      }
      return null
    }
    return new TextEncoder().encode(configured)
  }
  const isOptedIn = DEV_SESSION_KEY_OPT_IN.some((name) => process.env[name]?.trim() === '1')
  return process.env.NODE_ENV !== 'production' && isOptedIn
    ? new TextEncoder().encode('thally-dev-reader-session-key-not-secret')
    : null
}

/** Verified identity carried by a reader session. */
export interface ReaderSessionClaims {
  subject?: string
  groups: Array<string>
  /** Absolute expiry, seconds since the epoch. */
  expiresAt: number
}

/**
 * Sign a reader session. `expiresAt` is clamped to the configured maximum, so
 * an upstream token cannot extend a session past the site's policy.
 */
export async function signReaderSession(
  claims: { subject?: string; groups: ReadonlyArray<string>; expiresAt?: number },
  config: ReaderAuthConfig = getReaderAuthConfig(),
): Promise<{ token: string; maxAgeSeconds: number } | null> {
  const key = getReaderSessionKey()
  if (!key) return null
  const now = Math.floor(Date.now() / 1000)
  const ceiling = now + config.sessionMaxAgeSeconds
  const expiresAt = Math.min(claims.expiresAt && claims.expiresAt > now ? claims.expiresAt : ceiling, ceiling)
  const normalized = normalizeGroupsClaim([...claims.groups])
  if (!normalized) return null
  const groups = normalized
    .filter((group) => group.length <= READER_AUTH_LIMITS.maxGroupLength)
    .slice(0, READER_AUTH_LIMITS.maxGroups)
  const token = await new SignJWT({ groups, epoch: config.sessionEpoch })
    .setProtectedHeader({ alg: 'HS256', typ: SESSION_TYPE })
    .setIssuer(ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setSubject(claims.subject?.slice(0, 256) || 'reader')
    .sign(key)
  return { token, maxAgeSeconds: expiresAt - now }
}

/**
 * Verify a reader session cookie; null on any failure. Sessions from an older
 * `auth.session.epoch`, or whose subject is listed in `auth.tokens.revoked`,
 * are rejected.
 */
export async function verifyReaderSession(
  token: string | undefined | null,
  config: ReaderAuthConfig = getReaderAuthConfig(),
): Promise<ReaderContext | null> {
  const key = getReaderSessionKey()
  if (!key || !token || token.length > 4096) return null
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: SESSION_AUDIENCE,
      typ: SESSION_TYPE,
      requiredClaims: ['exp', 'iat', 'sub'],
      clockTolerance: SESSION_CLOCK_TOLERANCE_SECONDS,
    })
    if ((typeof payload.epoch === 'number' ? payload.epoch : 0) !== config.sessionEpoch) return null
    if (payload.sub && config.revokedTokens.has(payload.sub)) return null
    const groups = normalizeGroupsClaim(payload.groups)
    if (!groups) return null
    return { isAuthenticated: true, groups, subject: payload.sub, source: 'session' }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Agent tokens
// ---------------------------------------------------------------------------

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Parse `THALLY_READER_TOKEN_KEYS` (`kid:secret[,kid:secret…]`). The first
 * entry signs new tokens; every entry verifies. Malformed or short entries
 * are ignored, so a bad value disables a key rather than weakening it.
 */
export function getAgentTokenKeys(): Array<{ kid: string; key: Uint8Array }> {
  const raw = readReaderEnv(READER_AUTH_ENV.tokenKeys)
  if (!raw) return []
  const foreign = foreignSecrets()
  const sessionSecret = readReaderEnv(READER_AUTH_ENV.sessionSecret)
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .flatMap((entry) => {
      const separator = entry.indexOf(':')
      if (separator <= 0) return []
      const kid = entry.slice(0, separator).trim()
      const secret = entry.slice(separator + 1).trim()
      if (!KEY_ID_PATTERN.test(kid) || secret.length < MIN_SECRET_LENGTH) return []
      if (foreign.includes(secret) || secret === sessionSecret) return []
      return [{ kid, key: new TextEncoder().encode(secret) }]
    })
}

/** Options for minting an agent token (used by `scripts/mint-reader-token.ts`). */
export interface AgentTokenRequest {
  /** Human label stored as `sub`, e.g. "ci-docs-agent". */
  label: string
  groups: ReadonlyArray<string>
  /** Lifetime in seconds; capped at one year. */
  expiresInSeconds: number
  /** Token id; random when omitted. Revoke by listing it in `auth.tokens.revoked`. */
  tokenId?: string
}

/** Mint a read-only, group-scoped agent token with the first configured key. */
export async function mintAgentToken(request: AgentTokenRequest): Promise<{ token: string; tokenId: string; kid: string; expiresAt: number }> {
  const [signing] = getAgentTokenKeys()
  if (!signing) throw new Error(`${READER_AUTH_ENV.tokenKeys} has no usable "kid:secret" entry (secrets need ≥${MIN_SECRET_LENGTH} characters).`)
  const groups = normalizeGroupsClaim([...request.groups])
  if (!groups || groups.length > READER_AUTH_LIMITS.maxGroups || groups.some((group) => group.length > READER_AUTH_LIMITS.maxGroupLength)) {
    throw new Error(`Groups must be at most ${READER_AUTH_LIMITS.maxGroups} names of at most ${READER_AUTH_LIMITS.maxGroupLength} characters.`)
  }
  const lifetime = Math.min(Math.max(Math.floor(request.expiresInSeconds), 60), READER_AUTH_LIMITS.maxAgentTokenSeconds)
  const now = Math.floor(Date.now() / 1000)
  const tokenId = request.tokenId?.trim() || `tok_${crypto.randomUUID().replace(/-/g, '')}`
  const jwt = await new SignJWT({ groups, scope: AGENT_TOKEN_SCOPE })
    .setProtectedHeader({ alg: 'HS256', typ: TOKEN_TYPE, kid: signing.kid })
    .setIssuer(ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setSubject(request.label.slice(0, 128) || 'agent')
    .setJti(tokenId)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetime)
    .sign(signing.key)
  const token = `${AGENT_TOKEN_PREFIX}${jwt}`
  if (token.length > READER_AUTH_LIMITS.maxCredentialLength) throw new Error('The token is too long; grant fewer or shorter groups.')
  return { token, tokenId, kid: signing.kid, expiresAt: now + lifetime }
}

/**
 * Verify an agent token presented as `Authorization: Bearer thrt_…`.
 * Returns null for anything that is not a valid, unrevoked, read-scoped token.
 */
export async function verifyAgentToken(
  presented: string | undefined | null,
  config: ReaderAuthConfig = getReaderAuthConfig(),
): Promise<ReaderContext | null> {
  if (!config.isEnabled || !presented?.startsWith(AGENT_TOKEN_PREFIX) || presented.length > 4096) return null
  const jwt = presented.slice(AGENT_TOKEN_PREFIX.length)
  let kid: unknown
  try {
    kid = decodeProtectedHeader(jwt).kid
  } catch {
    return null
  }
  if (typeof kid !== 'string' || config.revokedTokens.has(kid)) return null
  const match = getAgentTokenKeys().find((candidate) => candidate.kid === kid)
  if (!match) return null
  try {
    const { payload } = await jwtVerify(jwt, match.key, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: TOKEN_AUDIENCE,
      typ: TOKEN_TYPE,
      requiredClaims: ['exp', 'iat', 'jti', 'sub'],
      clockTolerance: SESSION_CLOCK_TOLERANCE_SECONDS,
    })
    if (payload.scope !== AGENT_TOKEN_SCOPE) return null
    if (!payload.jti || config.revokedTokens.has(payload.jti)) return null
    if (payload.sub && config.revokedTokens.has(payload.sub)) return null
    if ((payload.exp ?? 0) - (payload.iat ?? 0) > READER_AUTH_LIMITS.maxAgentTokenSeconds) return null
    const groups = normalizeGroupsClaim(payload.groups)
    if (!groups) return null
    return { isAuthenticated: true, groups, subject: payload.sub, source: 'token' }
  } catch {
    return null
  }
}

/** Extract a bearer credential from an Authorization header value. */
export function bearerFromAuthorization(header: string | null | undefined): string | null {
  if (!header) return null
  const match = /^Bearer[ ]+([^\s]+)\s*$/i.exec(header)
  return match?.[1] ?? null
}
