/**
 * Verification of customer-signed JWT handoff tokens (server-only).
 *
 * In `jwt` mode the customer's own application authenticates the reader and
 * redirects to Thally with a short-lived signed JWT. Thally verifies it here
 * and, on success, issues its own reader session (see `session.ts`). The
 * handoff token itself is never stored.
 *
 * Exactly one key source may be configured:
 * - `THALLY_READER_JWT_SECRET` (≥ 32 chars)        → HS256 only
 * - `THALLY_READER_JWT_PUBLIC_KEY` (SPKI PEM)      → `auth.jwt.algorithms`
 * - `THALLY_READER_JWKS_URL` / `auth.jwt.jwksUrl`  → `auth.jwt.algorithms`
 * Configuring more than one is refused: an ambiguous key source is how
 * HS/RS confusion happens. The algorithm allowlist is pinned per source, so a
 * token can never choose `none` or move between symmetric and asymmetric.
 *
 * Every token must carry `exp` and `iat`, be no older than
 * `auth.jwt.maxTokenAgeSeconds`, and be bound to this site: by `aud` (the
 * configured audience, or the site origin by default) or, for Mintlify
 * compatibility, a `host` claim equal to the site host. `iss` is enforced when
 * configured. `jti` values are remembered until expiry to refuse replays
 * (best-effort, per instance).
 */

import 'server-only'

import {
  createRemoteJWKSet,
  importSPKI,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
  type ProtectedHeaderParameters,
} from 'jose'
import {
  READER_AUTH_ENV,
  getReaderAuthConfig,
  isAllowedEndpointUrl,
  readReaderEnv,
  type AsymmetricJwtAlgorithm,
  type ReaderAuthConfig,
} from './config'
import { normalizeGroupsClaim, readClaim } from './access'

/** Why a handoff failed. Deliberately coarse: details never reach the client. */
export type HandoffFailure = 'not_configured' | 'misconfigured' | 'invalid_token' | 'replayed'

export type HandoffResult =
  | { isValid: true; subject?: string; groups: Array<string>; expiresAt?: number }
  | { isValid: false; reason: HandoffFailure }

type KeySource =
  | { kind: 'secret'; key: Uint8Array }
  | { kind: 'pem'; pem: string }
  | { kind: 'jwks'; url: string }

// Large enough for directory-sized group claims; still bounded before any crypto.
const MAX_HANDOFF_TOKEN_LENGTH = 32 * 1024
const MIN_SECRET_LENGTH = 32

/** Resolve the single configured verification key source. */
function resolveKeySource(config: ReaderAuthConfig): KeySource | 'none' | 'ambiguous' | 'invalid' {
  const secret = readReaderEnv(READER_AUTH_ENV.jwtSecret)
  // Hosting dashboards often store PEMs with literal "\n" sequences.
  const pem = readReaderEnv(READER_AUTH_ENV.jwtPublicKey)?.replace(/\\n/g, '\n')
  const jwksUrl = readReaderEnv(READER_AUTH_ENV.jwksUrl) ?? config.jwt.jwksUrl
  const configured = [secret, pem, jwksUrl].filter(Boolean).length
  if (configured === 0) return 'none'
  if (configured > 1) return 'ambiguous'
  if (secret) return secret.length >= MIN_SECRET_LENGTH ? { kind: 'secret', key: new TextEncoder().encode(secret) } : 'invalid'
  if (pem) return pem.includes('BEGIN PUBLIC KEY') ? { kind: 'pem', pem } : 'invalid'
  return isAllowedEndpointUrl(jwksUrl) ? { kind: 'jwks', url: jwksUrl! } : 'invalid'
}

const pemKeyCache = new Map<string, Promise<CryptoKey>>()
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function pemKeyResolver(pem: string, allowed: ReadonlyArray<AsymmetricJwtAlgorithm>): JWTVerifyGetKey {
  return async (header: ProtectedHeaderParameters) => {
    // jose also enforces `algorithms`, but importing a key for an
    // unlisted algorithm must never be attempted in the first place.
    const alg = header.alg as AsymmetricJwtAlgorithm
    if (!allowed.includes(alg)) throw new Error('algorithm not allowed')
    const cacheKey = `${alg}\u0000${pem}`
    let key = pemKeyCache.get(cacheKey)
    if (!key) {
      // importSPKI rejects a key whose type does not match `alg` (an RSA key
      // cannot become an ES256 or EdDSA key), closing cross-algorithm tricks.
      key = importSPKI(pem, alg)
      pemKeyCache.set(cacheKey, key)
      key.catch(() => pemKeyCache.delete(cacheKey))
    }
    return key
  }
}

function jwksResolver(url: string): ReturnType<typeof createRemoteJWKSet> {
  let set = jwksCache.get(url)
  if (!set) {
    set = createRemoteJWKSet(new URL(url), { timeoutDuration: 5_000, cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 })
    jwksCache.set(url, set)
  }
  return set
}

// ---------------------------------------------------------------------------
// Replay protection
// ---------------------------------------------------------------------------

const MAX_REMEMBERED_TOKENS = 10_000
const seenTokenIds = new Map<string, number>()

/** Remember a token id until it expires; false when it was already used. */
function rememberTokenId(jti: string, expiresAt: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  if (seenTokenIds.size >= MAX_REMEMBERED_TOKENS) {
    for (const [id, exp] of seenTokenIds) if (exp <= now) seenTokenIds.delete(id)
    // Still full of live ids: drop the oldest insertions rather than grow unbounded.
    while (seenTokenIds.size >= MAX_REMEMBERED_TOKENS) {
      const oldest = seenTokenIds.keys().next().value
      if (oldest === undefined) break
      seenTokenIds.delete(oldest)
    }
  }
  const existing = seenTokenIds.get(jti)
  if (existing !== undefined && existing > now) return false
  seenTokenIds.set(jti, expiresAt)
  return true
}

/** Test hook. */
export function resetHandoffReplayCacheForTests(): void {
  seenTokenIds.clear()
  pemKeyCache.clear()
  jwksCache.clear()
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

function siteBinding(payload: JWTPayload, siteOrigins: ReadonlyArray<string>): boolean {
  const audiences = typeof payload.aud === 'string' ? [payload.aud] : Array.isArray(payload.aud) ? payload.aud : []
  const normalizedOrigins = siteOrigins.flatMap((origin) => {
    try {
      return [new URL(origin)]
    } catch {
      return []
    }
  })
  if (audiences.some((aud) => normalizedOrigins.some((origin) => aud.replace(/\/+$/, '') === origin.origin))) return true
  const host = (payload as { host?: unknown }).host
  return typeof host === 'string' && normalizedOrigins.some((origin) => host.toLowerCase() === origin.host.toLowerCase())
}

/**
 * Verify a handoff token and return the reader identity it vouches for.
 *
 * @param token       The raw JWT from the handoff request.
 * @param siteOrigins Origins this deployment answers on, used for the default
 *                    audience binding when `auth.jwt.audience` is not set.
 */
export async function verifyHandoffToken(
  token: string,
  siteOrigins: ReadonlyArray<string>,
  config: ReaderAuthConfig = getReaderAuthConfig(),
): Promise<HandoffResult> {
  if (!config.isEnabled || config.mode !== 'jwt') return { isValid: false, reason: 'not_configured' }
  const source = resolveKeySource(config)
  if (source === 'none') return { isValid: false, reason: 'not_configured' }
  if (source === 'ambiguous' || source === 'invalid') return { isValid: false, reason: 'misconfigured' }
  if (!token || token.length > MAX_HANDOFF_TOKEN_LENGTH) return { isValid: false, reason: 'invalid_token' }

  const options = {
    algorithms: source.kind === 'secret' ? ['HS256'] : [...config.jwt.algorithms],
    ...(config.jwt.issuer ? { issuer: config.jwt.issuer } : {}),
    ...(config.jwt.audience ? { audience: config.jwt.audience } : {}),
    requiredClaims: ['exp', 'iat'],
    maxTokenAge: config.jwt.maxTokenAgeSeconds,
    clockTolerance: config.jwt.clockSkewSeconds,
  }

  let payload: JWTPayload
  try {
    const result =
      source.kind === 'secret'
        ? await jwtVerify(token, source.key, options)
        : source.kind === 'pem'
          ? await jwtVerify(token, pemKeyResolver(source.pem, config.jwt.algorithms), options)
          : await jwtVerify(token, jwksResolver(source.url), options)
    payload = result.payload
  } catch {
    return { isValid: false, reason: 'invalid_token' }
  }

  // A future-dated iat would stretch the replay window past maxTokenAge.
  const now = Math.floor(Date.now() / 1000)
  if ((payload.iat ?? 0) > now + config.jwt.clockSkewSeconds) return { isValid: false, reason: 'invalid_token' }
  if (!config.jwt.audience && !siteBinding(payload, siteOrigins)) return { isValid: false, reason: 'invalid_token' }

  const groups = normalizeGroupsClaim(readClaim(payload as Record<string, unknown>, config.jwt.groupsClaim))
  if (!groups) return { isValid: false, reason: 'invalid_token' }

  if (typeof payload.jti === 'string' && payload.jti) {
    if (!rememberTokenId(payload.jti, (payload.exp ?? now) + config.jwt.clockSkewSeconds)) return { isValid: false, reason: 'replayed' }
  }

  // Mintlify's `expiresAt` sets the session length; signReaderSession clamps it.
  const expiresAt = (payload as { expiresAt?: unknown }).expiresAt
  const subject = typeof payload.sub === 'string' ? payload.sub : typeof (payload as { email?: unknown }).email === 'string' ? (payload as { email: string }).email : undefined
  return {
    isValid: true,
    groups,
    ...(subject ? { subject: subject.slice(0, 256) } : {}),
    ...(typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? { expiresAt: Math.floor(expiresAt) } : {}),
  }
}

/** Whether a handoff key source is configured (no secret values are returned). */
export function describeHandoffKeySource(config: ReaderAuthConfig = getReaderAuthConfig()): 'secret' | 'pem' | 'jwks' | 'none' | 'ambiguous' | 'invalid' {
  const source = resolveKeySource(config)
  return typeof source === 'string' ? source : source.kind
}
