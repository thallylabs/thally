/**
 * Reader sign-in with the customer's OpenID Connect provider (server-only).
 *
 * Authorization code + PKCE (S256) with `state` and `nonce`. The in-flight
 * values ride in a short-lived, HS256-signed, HttpOnly cookie scoped to the
 * callback path; nothing is stored server-side. The ID token is verified with
 * jose against the issuer's JWKS with a pinned asymmetric algorithm
 * allowlist, the exact discovered issuer, the client id as audience, `exp`,
 * `iat`, and the flow nonce. Groups come from a configurable ID-token claim.
 *
 * This deliberately does not reuse the admin OIDC helper in
 * `src/lib/auth/oidc.ts`: admin sign-in requires a verified email and returns
 * only that email, while readers are identified by `sub` plus groups. The two
 * flows use different cookies, secrets, and session types, so an admin login
 * can never produce a reader session or the reverse.
 */

import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'
import { SignJWT, createRemoteJWKSet, jwtVerify } from 'jose'
import {
  ASYMMETRIC_JWT_ALGORITHMS,
  READER_AUTH_ENV,
  getReaderAuthConfig,
  isAllowedEndpointUrl,
  readReaderEnv,
  type ReaderAuthConfig,
} from './config'
import { normalizeGroupsClaim, readClaim } from './access'
import { getReaderSessionKey } from './session'

export interface ReaderOidcSettings {
  issuer: string
  clientId: string
  /** Absent for public clients that rely on PKCE alone. */
  clientSecret?: string
  scopes: Array<string>
  groupsClaim: string
}

/** Resolve OIDC settings; env values override docs.json. Null when incomplete. */
export function getReaderOidcSettings(config: ReaderAuthConfig = getReaderAuthConfig()): ReaderOidcSettings | null {
  if (!config.isEnabled || config.mode !== 'oidc') return null
  const issuer = readReaderEnv(READER_AUTH_ENV.oidcIssuer) ?? config.oidc.issuer
  const clientId = readReaderEnv(READER_AUTH_ENV.oidcClientId) ?? config.oidc.clientId
  if (!isAllowedEndpointUrl(issuer) || !clientId) return null
  const scopes = config.oidc.scopes.includes('openid') ? config.oidc.scopes : ['openid', ...config.oidc.scopes]
  return {
    issuer,
    clientId,
    clientSecret: readReaderEnv(READER_AUTH_ENV.oidcClientSecret),
    scopes,
    groupsClaim: config.oidc.groupsClaim,
  }
}

interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  id_token_signing_alg_values_supported?: Array<string>
}

const DISCOVERY_TTL_MS = 60 * 60_000
const FETCH_TIMEOUT_MS = 5_000
const discoveryCache = new Map<string, { value: Discovery; expiresAt: number }>()
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

const normalizeIssuer = (value: string) => value.replace(/\/+$/, '')

/**
 * Fetch and validate the provider's discovery document. The advertised
 * issuer must equal the configured one and every endpoint must be HTTPS, so a
 * tampered or misrouted document cannot redirect tokens elsewhere.
 */
async function discover(issuer: string): Promise<Discovery> {
  const cached = discoveryCache.get(issuer)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const response = await fetch(`${normalizeIssuer(issuer)}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('OIDC discovery failed')
  const document = (await response.json()) as Partial<Discovery>
  if (
    typeof document.issuer !== 'string' ||
    normalizeIssuer(document.issuer) !== normalizeIssuer(issuer) ||
    !isAllowedEndpointUrl(document.authorization_endpoint) ||
    !isAllowedEndpointUrl(document.token_endpoint) ||
    !isAllowedEndpointUrl(document.jwks_uri)
  ) {
    throw new Error('OIDC discovery document is invalid')
  }
  const value = document as Discovery
  discoveryCache.set(issuer, { value, expiresAt: Date.now() + DISCOVERY_TTL_MS })
  return value
}

function jwksFor(uri: string) {
  let set = jwksCache.get(uri)
  if (!set) {
    set = createRemoteJWKSet(new URL(uri), { timeoutDuration: FETCH_TIMEOUT_MS })
    jwksCache.set(uri, set)
  }
  return set
}

function randomToken(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url')
}

/** Constant-time string comparison (hashing first equalizes lengths). */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest()
  const right = createHash('sha256').update(b).digest()
  return timingSafeEqual(left, right) && a.length === b.length
}

// ---------------------------------------------------------------------------
// Flow cookie
// ---------------------------------------------------------------------------

export const READER_OIDC_FLOW_COOKIE = 'thally_reader_oidc'
/** The flow cookie is only ever sent to the callback route. */
export const READER_OIDC_CALLBACK_PATH = '/api/reader/oidc/callback'
const FLOW_TTL_SECONDS = 10 * 60
const FLOW_AUDIENCE = 'thally-reader-oidc-flow'
const FLOW_TYPE = 'thally-reader-oidc-flow+jwt'

export interface ReaderOidcFlow {
  state: string
  nonce: string
  codeVerifier: string
  returnPath: string
}

async function signFlow(flow: ReaderOidcFlow): Promise<string | null> {
  const key = getReaderSessionKey()
  if (!key) return null
  return new SignJWT({ ...flow })
    .setProtectedHeader({ alg: 'HS256', typ: FLOW_TYPE })
    .setIssuer('thally-reader')
    .setAudience(FLOW_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${FLOW_TTL_SECONDS}s`)
    .sign(key)
}

/** Verify the flow cookie; null when absent, expired, or forged. */
export async function verifyReaderOidcFlow(token: string | undefined): Promise<ReaderOidcFlow | null> {
  const key = getReaderSessionKey()
  if (!key || !token || token.length > 4096) return null
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: 'thally-reader',
      audience: FLOW_AUDIENCE,
      typ: FLOW_TYPE,
      requiredClaims: ['exp'],
    })
    const { state, nonce, codeVerifier, returnPath } = payload as Record<string, unknown>
    if ([state, nonce, codeVerifier, returnPath].some((value) => typeof value !== 'string')) return null
    return { state, nonce, codeVerifier, returnPath } as ReaderOidcFlow
  } catch {
    return null
  }
}

export function readerOidcFlowCookieOptions() {
  return {
    httpOnly: true,
    // Lax: the IdP returns with a top-level GET navigation, which Lax permits.
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: READER_OIDC_CALLBACK_PATH,
    maxAge: FLOW_TTL_SECONDS,
  }
}

// ---------------------------------------------------------------------------
// Flow steps
// ---------------------------------------------------------------------------

/** Build the provider authorization URL and the signed flow cookie value. */
export async function startReaderOidcFlow(
  settings: ReaderOidcSettings,
  redirectUri: string,
  returnPath: string,
): Promise<{ url: string; flowCookie: string } | null> {
  const discovery = await discover(settings.issuer)
  const flow: ReaderOidcFlow = {
    state: randomToken(32),
    nonce: randomToken(32),
    codeVerifier: randomToken(48),
    returnPath,
  }
  const flowCookie = await signFlow(flow)
  if (!flowCookie) return null
  const challenge = createHash('sha256').update(flow.codeVerifier).digest('base64url')
  const params = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: settings.scopes.join(' '),
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  const url = new URL(discovery.authorization_endpoint)
  for (const [key, value] of params) url.searchParams.set(key, value)
  return { url: url.toString(), flowCookie }
}

/**
 * Exchange the authorization code and verify the ID token. Throws on any
 * failure; callers map every error to one generic response.
 */
export async function completeReaderOidcFlow(
  settings: ReaderOidcSettings,
  args: { code: string; redirectUri: string; flow: ReaderOidcFlow },
): Promise<{ subject: string; groups: Array<string>; expiresAt?: number }> {
  const discovery = await discover(settings.issuer)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: settings.clientId,
    code_verifier: args.flow.codeVerifier,
  })
  if (settings.clientSecret) body.set('client_secret', settings.clientSecret)
  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!tokenResponse.ok) throw new Error('token exchange failed')
  const tokens = (await tokenResponse.json()) as { id_token?: unknown }
  if (typeof tokens.id_token !== 'string' || tokens.id_token.length > 16 * 1024) throw new Error('no id_token')

  const advertised = discovery.id_token_signing_alg_values_supported
  const algorithms = ASYMMETRIC_JWT_ALGORITHMS.filter((alg) => !advertised?.length || advertised.includes(alg))
  if (algorithms.length === 0) throw new Error('no acceptable signing algorithm')

  const { payload } = await jwtVerify(tokens.id_token, jwksFor(discovery.jwks_uri), {
    issuer: discovery.issuer,
    audience: settings.clientId,
    algorithms,
    requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
    clockTolerance: 60,
  })
  if (typeof payload.nonce !== 'string' || !safeEqual(payload.nonce, args.flow.nonce)) throw new Error('nonce mismatch')
  // With several audiences, the token must have been issued to this client.
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== settings.clientId) throw new Error('azp mismatch')

  const groups = normalizeGroupsClaim(readClaim(payload as Record<string, unknown>, settings.groupsClaim))
  if (!groups) throw new Error('invalid groups claim')
  return { subject: String(payload.sub).slice(0, 256), groups }
}

/** Test hook. */
export function resetReaderOidcCachesForTests(): void {
  discoveryCache.clear()
  jwksCache.clear()
}
