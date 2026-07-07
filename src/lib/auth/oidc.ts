import { randomBytes, createHash } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * Google/Microsoft OIDC sign-in (C1). Verification-critical steps (JWKS,
 * signature, iss/aud/exp, nonce) go through `jose` — never hand-rolled. The flow
 * is standard authorization-code + PKCE.
 */

export interface OidcConfig {
  issuer: string
  clientId: string
  clientSecret: string
}

export function getOidcConfig(): OidcConfig | null {
  const issuer = process.env.DOX_OIDC_ISSUER?.trim()
  const clientId = process.env.DOX_OIDC_CLIENT_ID?.trim()
  const clientSecret = process.env.DOX_OIDC_CLIENT_SECRET?.trim()
  if (!issuer || !clientId || !clientSecret) return null
  return { issuer, clientId, clientSecret }
}

interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

const discoveryCache = new Map<string, Discovery>()
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

async function discover(issuer: string): Promise<Discovery> {
  const cached = discoveryCache.get(issuer)
  if (cached) return cached
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status}) for ${issuer}`)
  const d = (await res.json()) as Discovery
  discoveryCache.set(issuer, d)
  return d
}

function jwksFor(uri: string) {
  let set = jwksCache.get(uri)
  if (!set) {
    set = createRemoteJWKSet(new URL(uri))
    jwksCache.set(uri, set)
  }
  return set
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

export interface AuthRequest {
  url: string
  state: string
  nonce: string
  codeVerifier: string
}

/** Build the IdP authorize URL with PKCE, state, and nonce. */
export async function buildAuthorizeUrl(config: OidcConfig, redirectUri: string): Promise<AuthRequest> {
  const d = await discover(config.issuer)
  const state = base64url(randomBytes(32))
  const nonce = base64url(randomBytes(32))
  const codeVerifier = base64url(randomBytes(48))
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest())

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return { url: `${d.authorization_endpoint}?${params.toString()}`, state, nonce, codeVerifier }
}

/**
 * Exchange the code for tokens and verify the ID token. Returns the verified
 * email, or throws. The nonce binds the token to this browser's flow.
 */
export async function exchangeAndVerify(
  config: OidcConfig,
  args: { code: string; redirectUri: string; codeVerifier: string; nonce: string },
): Promise<{ email: string }> {
  const d = await discover(config.issuer)

  const tokenRes = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: args.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: args.codeVerifier,
    }),
  })
  if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status})`)
  const tokens = (await tokenRes.json()) as { id_token?: string }
  if (!tokens.id_token) throw new Error('No id_token in token response')

  const { payload } = await jwtVerify(tokens.id_token, jwksFor(d.jwks_uri), {
    issuer: d.issuer,
    audience: config.clientId,
  })

  if (payload.nonce !== args.nonce) throw new Error('OIDC nonce mismatch')
  const email = typeof payload.email === 'string' ? payload.email : ''
  // Require the IdP to explicitly vouch for the email. Treating an ABSENT
  // email_verified as verified is the "nOAuth" bypass: on Azure/Entra and
  // generic IdPs an attacker can set an arbitrary `email` claim and match a
  // domain-based roster grant. Absent/false/non-true → reject.
  const ev = payload.email_verified
  const emailVerified = ev === true || (typeof ev === 'string' && ['true', '1'].includes(ev.trim().toLowerCase()))
  if (!email || !emailVerified) throw new Error('OIDC identity has no verified email')

  return { email }
}
