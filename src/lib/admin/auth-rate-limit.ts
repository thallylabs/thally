/**
 * Small, runtime-portable password-attempt limiter for authentication routes.
 *
 * The map is deliberately bounded and contains only normalized network
 * prefixes. It is process/isolate-local, so it limits the work one instance
 * will accept but is not a globally durable security boundary. Production
 * operators should also rate-limit these paths at their hosting provider.
 */

import ipaddr from 'ipaddr.js'

const DEFAULT_LIMIT = 8
const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX_IDENTITIES = 2_048
const MAX_ADDRESS_HEADER_LENGTH = 128

export interface AuthAttemptScope {
  name: 'admin' | 'docs'
}

interface AttemptWindow {
  count: number
  expiresAt: number
}

export interface AuthAttemptDecision {
  allowed: boolean
  key: string
  retryAfter: number
}

export interface AuthAttemptLimiterOptions {
  limit?: number
  windowMs?: number
  maxIdentities?: number
}

export interface AuthAttemptLimiter {
  reserve(scope: AuthAttemptScope['name'], headers: Headers, now?: number): AuthAttemptDecision
  reset(key: string): void
  size(): number
}

function boundedAddress(value: string | null): string | null {
  const candidate = value?.trim()
  return candidate && candidate.length <= MAX_ADDRESS_HEADER_LENGTH ? candidate : null
}

/**
 * Normalize the best available client address without retaining a raw header.
 * IPv4-mapped addresses collapse to IPv4 and IPv6 clients share a /64 so
 * rotating privacy addresses cannot create an unbounded set of counters.
 */
export function normalizeAuthClientIdentity(headers: Headers): string {
  const direct =
    boundedAddress(headers.get('cf-connecting-ip')) ??
    boundedAddress(headers.get('x-nf-client-connection-ip')) ??
    boundedAddress(headers.get('x-real-ip'))
  const forwarded = boundedAddress(headers.get('x-forwarded-for')?.split(',').at(-1) ?? null)
  const candidate = direct ?? forwarded
  if (!candidate || !ipaddr.isValid(candidate)) return 'unknown'

  const address = ipaddr.process(candidate)
  if (address.kind() === 'ipv4') return address.toNormalizedString()

  const bytes = address.toByteArray()
  bytes.fill(0, 8)
  return `${ipaddr.fromByteArray(bytes).toNormalizedString()}/64`
}

/** Create an isolated limiter, primarily for deterministic tests. */
export function createAuthAttemptLimiter(
  options: AuthAttemptLimiterOptions = {},
): AuthAttemptLimiter {
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT))
  const windowMs = Math.max(1_000, Math.floor(options.windowMs ?? DEFAULT_WINDOW_MS))
  const maxIdentities = Math.max(1, Math.floor(options.maxIdentities ?? DEFAULT_MAX_IDENTITIES))
  const attempts = new Map<string, AttemptWindow>()

  function prune(now: number): void {
    for (const [key, window] of attempts) {
      if (window.expiresAt <= now) attempts.delete(key)
    }
    while (attempts.size >= maxIdentities) {
      const oldest = attempts.keys().next().value as string | undefined
      if (!oldest) break
      attempts.delete(oldest)
    }
  }

  return {
    reserve(scope, headers, now = Date.now()) {
      const key = `${scope}:${normalizeAuthClientIdentity(headers)}`
      let window = attempts.get(key)
      if (!window || window.expiresAt <= now) {
        prune(now)
        window = { count: 0, expiresAt: now + windowMs }
        attempts.set(key, window)
      }
      window.count += 1
      // Refresh insertion order so capacity eviction removes the least
      // recently attempted identity, not a currently active one.
      attempts.delete(key)
      attempts.set(key, window)
      return {
        allowed: window.count <= limit,
        key,
        retryAfter: Math.max(1, Math.ceil((window.expiresAt - now) / 1_000)),
      }
    },
    reset(key) {
      attempts.delete(key)
    },
    size() {
      return attempts.size
    },
  }
}

const authAttemptLimiter = createAuthAttemptLimiter()

/** Reserve one password-verification attempt before any expensive work. */
export function reserveAuthAttempt(
  scope: AuthAttemptScope['name'],
  headers: Headers,
): AuthAttemptDecision {
  return authAttemptLimiter.reserve(scope, headers)
}

/** Clear a successful client's current failure window. */
export function resetAuthAttempts(key: string): void {
  authAttemptLimiter.reset(key)
}
