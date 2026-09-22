/** Unit coverage for the bounded, runtime-portable password-attempt limiter. */

import { describe, expect, it } from 'vitest'
import {
  createAuthAttemptLimiter,
  normalizeAuthClientIdentity,
} from '@/lib/admin/auth-rate-limit'

describe('normalizeAuthClientIdentity', () => {
  it('prefers provider client headers and normalizes mapped IPv4', () => {
    const headers = new Headers({
      'cf-connecting-ip': '::ffff:192.0.2.8',
      'x-forwarded-for': '198.51.100.4, 198.51.100.5',
    })
    expect(normalizeAuthClientIdentity(headers)).toBe('192.0.2.8')
  })

  it('uses the proxy-adjacent forwarded address instead of an attacker-prepended one', () => {
    const headers = new Headers({
      'x-forwarded-for': '198.51.100.4, 203.0.113.9',
    })
    expect(normalizeAuthClientIdentity(headers)).toBe('203.0.113.9')
  })

  it('groups IPv6 privacy addresses by normalized /64', () => {
    const first = normalizeAuthClientIdentity(new Headers({ 'x-real-ip': '2001:db8:1:2::1' }))
    const second = normalizeAuthClientIdentity(new Headers({ 'x-real-ip': '2001:db8:1:2::ffff' }))
    expect(first).toBe('2001:db8:1:2:0:0:0:0/64')
    expect(second).toBe(first)
  })

  it('collapses missing, malformed, and oversized values to one bounded identity', () => {
    expect(normalizeAuthClientIdentity(new Headers())).toBe('unknown')
    expect(normalizeAuthClientIdentity(new Headers({ 'x-real-ip': 'not-an-ip' }))).toBe('unknown')
    expect(normalizeAuthClientIdentity(new Headers({ 'x-real-ip': '1'.repeat(129) }))).toBe('unknown')
  })
})

describe('createAuthAttemptLimiter', () => {
  it('blocks after the limit with Retry-After and resets after success/window expiry', () => {
    const limiter = createAuthAttemptLimiter({ limit: 2, windowMs: 10_000 })
    const headers = new Headers({ 'x-real-ip': '192.0.2.9' })
    const first = limiter.reserve('docs', headers, 1_000)
    expect(first.allowed).toBe(true)
    expect(limiter.reserve('docs', headers, 2_000).allowed).toBe(true)
    expect(limiter.reserve('docs', headers, 2_500)).toMatchObject({
      allowed: false,
      retryAfter: 9,
    })

    limiter.reset(first.key)
    expect(limiter.reserve('docs', headers, 3_000).allowed).toBe(true)
    expect(limiter.reserve('docs', headers, 14_000).allowed).toBe(true)
  })

  it('separates auth scopes and never exceeds its identity bound', () => {
    const limiter = createAuthAttemptLimiter({ limit: 1, maxIdentities: 2 })
    const address = (value: string) => new Headers({ 'x-real-ip': value })

    expect(limiter.reserve('admin', address('192.0.2.1'), 1_000).allowed).toBe(true)
    expect(limiter.reserve('docs', address('192.0.2.1'), 1_000).allowed).toBe(true)
    expect(limiter.reserve('docs', address('192.0.2.2'), 1_000).allowed).toBe(true)
    expect(limiter.size()).toBe(2)
  })
})
