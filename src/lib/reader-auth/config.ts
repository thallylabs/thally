/**
 * Reader-authentication configuration (edge-safe).
 *
 * Reader auth decides who may READ documentation pages. It is unrelated to
 * the admin team (`src/lib/auth/*`): different cookies, secrets, audiences
 * and token types, so a credential for one can never satisfy the other.
 *
 * Non-secret policy lives in the `auth` block of `docs.json` (or the managed
 * release's `THALLY_DOCS_CONFIG` snapshot, which goes through the same
 * reader). Secrets live only in server-side environment variables, each with
 * its legacy `DOX_*` fallback. Nothing in this module may be imported by a
 * client component: it reads `process.env` secrets.
 *
 * Invariants:
 * - An `auth` block whose mode is unknown or malformed FAILS CLOSED: reader
 *   auth is treated as enabled with a private default and no way to sign in,
 *   so only pages marked `public: true` are served. A typo must never publish
 *   a private site.
 * - `password` mode (or no `auth` block) leaves the existing shared-password
 *   gate untouched; reader auth is then disabled and pages restricted with
 *   `groups` / `public: false` are withheld from everyone.
 */

import { getDocsJsonConfig } from '@/lib/docs-json-config'
import type { ReaderAuthSecretEnv } from '@/lib/cloud-bridge/types'

/** Authentication modes accepted in `docs.json` → `auth.mode`. */
export type ReaderAuthMode = 'password' | 'jwt' | 'oidc'

/** Visibility of pages that carry no `public` / `groups` frontmatter. */
export type ReaderDefaultVisibility = 'public' | 'private'

/** Asymmetric algorithms accepted for customer-signed handoff tokens. */
export const ASYMMETRIC_JWT_ALGORITHMS = ['RS256', 'PS256', 'ES256', 'EdDSA'] as const
export type AsymmetricJwtAlgorithm = (typeof ASYMMETRIC_JWT_ALGORITHMS)[number]

/** Hard upper bounds that configuration cannot raise. */
export const READER_AUTH_LIMITS = {
  /** Longest reader session a handoff or OIDC login may establish (30 days). */
  maxSessionSeconds: 30 * 24 * 60 * 60,
  /** Default reader session length (8 hours). */
  defaultSessionSeconds: 8 * 60 * 60,
  /** Longest accepted lifetime (exp − iat) of a handoff JWT. */
  maxHandoffTokenSeconds: 10 * 60,
  /** Default accepted lifetime of a handoff JWT (Mintlify recommends ≤ 10 s). */
  defaultHandoffTokenSeconds: 5 * 60,
  /** Largest tolerated clock skew. */
  maxClockSkewSeconds: 120,
  defaultClockSkewSeconds: 30,
  /**
   * Bounds on an upstream groups claim. Directory users often hold hundreds
   * of groups, so these are generous; sessions keep only the groups the
   * site's content references (see `completeReaderSignIn`).
   */
  maxClaimGroups: 1000,
  maxClaimGroupLength: 256,
  /** Bounds on the groups stored in a session or agent token. */
  maxGroups: 50,
  maxGroupLength: 100,
  /** Longest signed session or agent token; keeps the cookie under browsers' 4 KB limit. */
  maxCredentialLength: 3800,
  /** Agent tokens can live at most one year. */
  maxAgentTokenSeconds: 365 * 24 * 60 * 60,
} as const

export interface ReaderJwtConfig {
  /** Expected `iss`; when set, tokens without it are rejected. */
  issuer?: string
  /** Expected `aud`. Defaults to the docs site origin (or a matching `host` claim). */
  audience?: string
  /** Public JWKS endpoint (may also come from THALLY_READER_JWKS_URL). */
  jwksUrl?: string
  /** Allowed asymmetric algorithms for a PEM/JWKS key. HS256 is implied by a shared secret. */
  algorithms: Array<AsymmetricJwtAlgorithm>
  /** Claim holding the reader's groups; an exact key or a dotted path. */
  groupsClaim: string
  /** Maximum accepted `exp − iat` of the handoff token. */
  maxTokenAgeSeconds: number
  clockSkewSeconds: number
}

export interface ReaderOidcConfig {
  issuer?: string
  clientId?: string
  scopes: Array<string>
  /** ID-token claim holding the reader's groups; an exact key or a dotted path. */
  groupsClaim: string
}

export interface ReaderAuthConfig {
  mode: ReaderAuthMode
  /** True when reader auth (jwt/oidc) governs page access. */
  isEnabled: boolean
  /** True when the `auth` block is present but unusable; implies fail-closed. */
  isMisconfigured: boolean
  defaultVisibility: ReaderDefaultVisibility
  /** JWT mode: customer login page; anonymous readers are sent here with `redirect=<path>`. */
  loginUrl?: string
  /** Optional customer page to visit after a reader signs out. */
  logoutUrl?: string
  sessionMaxAgeSeconds: number
  jwt: ReaderJwtConfig
  oidc: ReaderOidcConfig
  /** Agent-token ids (`jti`) or signing key ids (`kid`) that must be rejected. */
  revokedTokens: ReadonlySet<string>
}

/**
 * Environment variables carrying reader-auth secrets. Exported so the Cloud
 * bridge contract and documentation name exactly one source of truth.
 */
export const READER_AUTH_ENV = {
  sessionSecret: 'THALLY_READER_SESSION_SECRET',
  jwtSecret: 'THALLY_READER_JWT_SECRET',
  jwtPublicKey: 'THALLY_READER_JWT_PUBLIC_KEY',
  jwksUrl: 'THALLY_READER_JWKS_URL',
  oidcIssuer: 'THALLY_READER_OIDC_ISSUER',
  oidcClientId: 'THALLY_READER_OIDC_CLIENT_ID',
  oidcClientSecret: 'THALLY_READER_OIDC_CLIENT_SECRET',
  tokenKeys: 'THALLY_READER_TOKEN_KEYS',
} as const satisfies Record<string, ReaderAuthSecretEnv>

/** Read a THALLY_* variable with its legacy DOX_* fallback; blank means unset. */
export function readReaderEnv(name: (typeof READER_AUTH_ENV)[keyof typeof READER_AUTH_ENV]): string | undefined {
  const legacy = name.replace(/^THALLY_/, 'DOX_')
  const value = process.env[name]?.trim() || process.env[legacy]?.trim()
  return value || undefined
}

interface RawAuthBlock {
  mode?: unknown
  default?: unknown
  loginUrl?: unknown
  logoutUrl?: unknown
  session?: { maxAgeSeconds?: unknown }
  jwt?: Record<string, unknown>
  oidc?: Record<string, unknown>
  tokens?: { revoked?: unknown }
}

const MODES: Record<string, ReaderAuthMode> = { password: 'password', jwt: 'jwt', oidc: 'oidc' }

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), min), max)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Only absolute https URLs (or http on loopback for local development) are usable endpoints. */
export function isAllowedEndpointUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function stringList(value: unknown): Array<string> {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()) : []
}

function parseAlgorithms(value: unknown): Array<AsymmetricJwtAlgorithm> {
  const allowed = new Set<string>(ASYMMETRIC_JWT_ALGORITHMS)
  const requested = stringList(value).filter((alg) => allowed.has(alg)) as Array<AsymmetricJwtAlgorithm>
  // `none` and every HS* value are silently dropped by the allowlist above;
  // an empty or invalid list falls back to the full asymmetric set.
  return requested.length ? requested : [...ASYMMETRIC_JWT_ALGORITHMS]
}

let cachedSource: unknown
let cachedConfig: ReaderAuthConfig | null = null
let hasWarnedMisconfiguration = false

/** Build the effective config from a raw `auth` block. Exported for tests. */
export function parseReaderAuthConfig(rawAuth: unknown): ReaderAuthConfig {
  const block = objectOrNull(rawAuth) as RawAuthBlock | null
  const rawMode = typeof block?.mode === 'string' ? block.mode.trim().toLowerCase() : undefined
  const mode = rawMode ? MODES[rawMode] : undefined
  const isMisconfigured = Boolean(block) && !mode
  const isEnabled = mode === 'jwt' || mode === 'oidc'
  const jwt = objectOrNull(block?.jwt) ?? {}
  const oidc = objectOrNull(block?.oidc) ?? {}
  const defaultVisibility: ReaderDefaultVisibility =
    // Mintlify semantics: once authentication is on, pages are private unless
    // marked public. Anything but an explicit "public" keeps that default.
    isEnabled && block?.default === 'public' ? 'public' : isEnabled || isMisconfigured ? 'private' : 'public'

  if (isMisconfigured && !hasWarnedMisconfiguration) {
    hasWarnedMisconfiguration = true
    console.warn('docs.json `auth.mode` must be "password", "jwt" or "oidc"; serving only `public: true` pages until it is fixed.')
  }

  const loginUrl = optionalString(block?.loginUrl)
  const logoutUrl = optionalString(block?.logoutUrl)
  return {
    mode: mode ?? 'password',
    isEnabled,
    isMisconfigured,
    defaultVisibility,
    loginUrl: isAllowedEndpointUrl(loginUrl) ? loginUrl : undefined,
    logoutUrl: isAllowedEndpointUrl(logoutUrl) ? logoutUrl : undefined,
    sessionMaxAgeSeconds: boundedInteger(
      objectOrNull(block?.session)?.maxAgeSeconds,
      READER_AUTH_LIMITS.defaultSessionSeconds,
      60,
      READER_AUTH_LIMITS.maxSessionSeconds,
    ),
    jwt: {
      issuer: optionalString(jwt.issuer),
      audience: optionalString(jwt.audience),
      jwksUrl: optionalString(jwt.jwksUrl),
      algorithms: parseAlgorithms(jwt.algorithms),
      groupsClaim: optionalString(jwt.groupsClaim) ?? 'groups',
      maxTokenAgeSeconds: boundedInteger(
        jwt.maxTokenAgeSeconds,
        READER_AUTH_LIMITS.defaultHandoffTokenSeconds,
        5,
        READER_AUTH_LIMITS.maxHandoffTokenSeconds,
      ),
      clockSkewSeconds: boundedInteger(
        jwt.clockSkewSeconds,
        READER_AUTH_LIMITS.defaultClockSkewSeconds,
        0,
        READER_AUTH_LIMITS.maxClockSkewSeconds,
      ),
    },
    oidc: {
      issuer: optionalString(oidc.issuer),
      clientId: optionalString(oidc.clientId),
      scopes: stringList(oidc.scopes).length ? stringList(oidc.scopes) : ['openid', 'email', 'profile'],
      groupsClaim: optionalString(oidc.groupsClaim) ?? 'groups',
    },
    revokedTokens: new Set(stringList(objectOrNull(block?.tokens)?.revoked)),
  }
}

/**
 * The active reader-auth configuration. Memoized by the identity of the
 * resolved docs.json object, which `getDocsJsonConfig` keeps stable until the
 * managed binding changes.
 */
export function getReaderAuthConfig(): ReaderAuthConfig {
  const docsConfig = getDocsJsonConfig<{ auth?: unknown }>()
  if (cachedConfig && cachedSource === docsConfig) return cachedConfig
  cachedSource = docsConfig
  cachedConfig = parseReaderAuthConfig(docsConfig.auth)
  return cachedConfig
}

/**
 * Whether reader auth governs this site, including the fail-closed
 * misconfiguration state. Callers use this to decide that responses vary by
 * reader (no shared caching, no static prerendering).
 */
export function isReaderAuthActive(config: ReaderAuthConfig = getReaderAuthConfig()): boolean {
  return config.isEnabled || config.isMisconfigured
}

/** Clear memoized state between tests. */
export function resetReaderAuthConfigForTests(): void {
  cachedSource = undefined
  cachedConfig = null
  hasWarnedMisconfiguration = false
}
