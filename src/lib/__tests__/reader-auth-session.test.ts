/** Reader sessions and agent tokens stay separate from each other and from admin credentials. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT, UnsecuredJWT } from 'jose'
import { parseReaderAuthConfig } from '@/lib/reader-auth/config'
import {
  AGENT_TOKEN_PREFIX,
  bearerFromAuthorization,
  mintAgentToken,
  signReaderSession,
  verifyAgentToken,
  verifyReaderSession,
} from '@/lib/reader-auth/session'
import { resolveReader } from '@/lib/reader-auth/context'
import { signSession, verifySession } from '@/lib/auth/session'

const SESSION_SECRET = 's'.repeat(40)
const TOKEN_SECRET = 't'.repeat(40)
const ADMIN_SECRET = 'a'.repeat(40)
const config = parseReaderAuthConfig({ mode: 'jwt', default: 'public', tokens: { revoked: ['tok_revoked', 'old'] } })

beforeEach(() => {
  vi.stubEnv('THALLY_READER_SESSION_SECRET', SESSION_SECRET)
  vi.stubEnv('THALLY_READER_TOKEN_KEYS', `k1:${TOKEN_SECRET},old:${'o'.repeat(40)}`)
  vi.stubEnv('THALLY_AUTH_SECRET', ADMIN_SECRET)
})

afterEach(() => vi.unstubAllEnvs())

describe('reader sessions', () => {
  it('round-trips subject and groups', async () => {
    const session = await signReaderSession({ subject: 'u1', groups: ['beta'] }, config)
    expect(session?.maxAgeSeconds).toBe(config.sessionMaxAgeSeconds)
    expect(await verifyReaderSession(session!.token)).toEqual({ isAuthenticated: true, groups: ['beta'], subject: 'u1', source: 'session' })
  })

  it('clamps an upstream expiry to the configured maximum', async () => {
    const far = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600
    const session = await signReaderSession({ groups: [], expiresAt: far }, config)
    expect(session!.maxAgeSeconds).toBeLessThanOrEqual(config.sessionMaxAgeSeconds)
    const near = Math.floor(Date.now() / 1000) + 120
    expect((await signReaderSession({ groups: [], expiresAt: near }, config))!.maxAgeSeconds).toBeLessThanOrEqual(120)
  })

  it('rejects tampered, expired, unsigned, and foreign-typed tokens', async () => {
    const { token } = (await signReaderSession({ groups: ['beta'] }, config))!
    const [header, , signature] = token.split('.')
    const forgedPayload = Buffer.from(JSON.stringify({ groups: ['admin'], sub: 'x', iss: 'thally-reader', aud: 'thally-reader-session', iat: 1, exp: 9_999_999_999 })).toString('base64url')
    expect(await verifyReaderSession(`${header}.${forgedPayload}.${signature}`)).toBeNull()

    const key = new TextEncoder().encode(SESSION_SECRET)
    const expired = await new SignJWT({ groups: [] }).setProtectedHeader({ alg: 'HS256', typ: 'thally-reader-session+jwt' })
      .setIssuer('thally-reader').setAudience('thally-reader-session').setSubject('x').setIssuedAt(1).setExpirationTime(2).sign(key)
    expect(await verifyReaderSession(expired)).toBeNull()

    const unsigned = new UnsecuredJWT({ groups: [], sub: 'x' }).setIssuer('thally-reader').setAudience('thally-reader-session').setIssuedAt().setExpirationTime('1h').encode()
    expect(await verifyReaderSession(unsigned)).toBeNull()

    // Same key, right claims, but no reader-session `typ`: rejected.
    const untyped = await new SignJWT({ groups: [] }).setProtectedHeader({ alg: 'HS256' })
      .setIssuer('thally-reader').setAudience('thally-reader-session').setSubject('x').setIssuedAt().setExpirationTime('1h').sign(key)
    expect(await verifyReaderSession(untyped)).toBeNull()
  })

  it('is never accepted as an admin session, and an admin session is never a reader session', async () => {
    const reader = (await signReaderSession({ subject: 'owner@example.com', groups: [] }, config))!.token
    expect(await verifySession(reader)).toBeNull()
    const admin = await signSession({ email: 'owner@example.com' })
    expect(admin).toBeTruthy()
    expect(await verifyReaderSession(admin!)).toBeNull()
  })

  it('refuses to sign with a secret shared with the admin subsystem', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubEnv('THALLY_READER_SESSION_SECRET', ADMIN_SECRET)
    expect(await signReaderSession({ groups: [] }, config)).toBeNull()
    vi.stubEnv('THALLY_READER_SESSION_SECRET', 'too-short')
    expect(await signReaderSession({ groups: [] }, config)).toBeNull()
  })

  it('rejects sessions from an older epoch and sessions of a revoked subject', async () => {
    const token = (await signReaderSession({ subject: 'u-7', groups: ['beta'] }, config))!.token
    expect(await verifyReaderSession(token, config)).not.toBeNull()
    const bumped = parseReaderAuthConfig({ mode: 'jwt', default: 'public', session: { epoch: 1 } })
    expect(await verifyReaderSession(token, bumped)).toBeNull()
    const revoked = parseReaderAuthConfig({ mode: 'jwt', default: 'public', tokens: { revoked: ['u-7'] } })
    expect(await verifyReaderSession(token, revoked)).toBeNull()
    const current = (await signReaderSession({ subject: 'u-8', groups: [] }, bumped))!.token
    expect(await verifyReaderSession(current, bumped)).not.toBeNull()
  })

  it('uses the public development key only with an explicit opt-in outside production, whatever the Host', async () => {
    vi.stubEnv('THALLY_READER_SESSION_SECRET', '')
    vi.stubEnv('NODE_ENV', 'development')
    expect(await signReaderSession({ groups: [] }, config)).toBeNull()
    vi.stubEnv('THALLY_READER_ALLOW_DEV_SESSION_KEY', '1')
    const dev = await signReaderSession({ groups: [] }, config)
    expect(dev).not.toBeNull()
    expect(await verifyReaderSession(dev!.token, config)).not.toBeNull()
    // Production ignores the opt-in entirely, including for already-issued dev sessions.
    vi.stubEnv('NODE_ENV', 'production')
    expect(await signReaderSession({ groups: [] }, config)).toBeNull()
    expect(await verifyReaderSession(dev!.token, config)).toBeNull()
  })

  it('never lets a client-chosen Host header unlock the development key', async () => {
    const { readFileSync } = await import('node:fs')
    const sources = ['src/lib/reader-auth/session.ts', 'src/lib/reader-auth/context.ts', 'src/lib/reader-auth/oidc.ts']
      .map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(sources).not.toMatch(/requestHost|isLoopbackHost|get\('host'\)/)
  })

  it('has no production fallback key', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('THALLY_READER_SESSION_SECRET', '')
    expect(await signReaderSession({ groups: [] }, config)).toBeNull()
  })
})

describe('agent tokens', () => {
  it('mints a prefixed, read-scoped token that verifies with its groups', async () => {
    const minted = await mintAgentToken({ label: 'ci', groups: ['beta'], expiresInSeconds: 3600 })
    expect(minted.token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true)
    expect(minted.kid).toBe('k1')
    expect(await verifyAgentToken(minted.token, config)).toEqual({ isAuthenticated: true, groups: ['beta'], subject: 'ci', source: 'token' })
  })

  it('honors revocation by token id and by key id', async () => {
    const revoked = await mintAgentToken({ label: 'ci', groups: [], expiresInSeconds: 3600, tokenId: 'tok_revoked' })
    expect(await verifyAgentToken(revoked.token, config)).toBeNull()
    vi.stubEnv('THALLY_READER_TOKEN_KEYS', `old:${'o'.repeat(40)}`)
    const byOldKey = await mintAgentToken({ label: 'ci', groups: [], expiresInSeconds: 3600 })
    expect(await verifyAgentToken(byOldKey.token, config)).toBeNull()
  })

  it('stops verifying once its key is removed from the environment', async () => {
    const minted = await mintAgentToken({ label: 'ci', groups: [], expiresInSeconds: 3600 })
    vi.stubEnv('THALLY_READER_TOKEN_KEYS', `k2:${'z'.repeat(40)}`)
    expect(await verifyAgentToken(minted.token, config)).toBeNull()
  })

  it('rejects a reader session or a wrong-scope token presented as a bearer token', async () => {
    const session = (await signReaderSession({ groups: ['beta'] }, config))!.token
    expect(await verifyAgentToken(`${AGENT_TOKEN_PREFIX}${session}`, config)).toBeNull()
    expect(await verifyAgentToken(session, config)).toBeNull()

    const writeScoped = await new SignJWT({ groups: [], scope: 'docs:write' })
      .setProtectedHeader({ alg: 'HS256', typ: 'thally-reader-token+jwt', kid: 'k1' })
      .setIssuer('thally-reader').setAudience('thally-reader-token').setSubject('x').setJti('j1').setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(TOKEN_SECRET))
    expect(await verifyAgentToken(`${AGENT_TOKEN_PREFIX}${writeScoped}`, config)).toBeNull()
  })

  it('is not accepted as a reader session cookie', async () => {
    const minted = await mintAgentToken({ label: 'ci', groups: ['beta'], expiresInSeconds: 3600 })
    expect(await verifyReaderSession(minted.token.slice(AGENT_TOKEN_PREFIX.length))).toBeNull()
  })

  it('verifies nothing when reader auth is disabled', async () => {
    const minted = await mintAgentToken({ label: 'ci', groups: [], expiresInSeconds: 3600 })
    expect(await verifyAgentToken(minted.token, parseReaderAuthConfig(undefined))).toBeNull()
  })
})

describe('resolveReader', () => {
  it('prefers a presented bearer token and never falls back to the cookie when it is invalid', async () => {
    const cookie = (await signReaderSession({ groups: ['beta'] }, config))!.token
    expect((await resolveReader(null, cookie, config)).groups).toEqual(['beta'])
    expect(await resolveReader('Bearer thrt_invalid', cookie, config)).toMatchObject({ isAuthenticated: false })
    const minted = await mintAgentToken({ label: 'ci', groups: ['ga'], expiresInSeconds: 3600 })
    expect((await resolveReader(`Bearer ${minted.token}`, cookie, config)).groups).toEqual(['ga'])
  })

  it('is anonymous whenever reader auth is disabled', async () => {
    const cookie = (await signReaderSession({ groups: ['beta'] }, config))!.token
    expect(await resolveReader(null, cookie, parseReaderAuthConfig(undefined))).toMatchObject({ isAuthenticated: false })
  })

  it('parses only well-formed bearer headers', () => {
    expect(bearerFromAuthorization('Bearer abc')).toBe('abc')
    expect(bearerFromAuthorization('bearer abc')).toBe('abc')
    expect(bearerFromAuthorization('Basic abc')).toBeNull()
    expect(bearerFromAuthorization('Bearer a b')).toBeNull()
  })
})
