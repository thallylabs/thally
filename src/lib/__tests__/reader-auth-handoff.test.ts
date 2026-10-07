/** Customer-signed JWT handoff verification: algorithms, bindings, lifetimes, replay. */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT, UnsecuredJWT, exportSPKI, generateKeyPair, type CryptoKey } from 'jose'
import { parseReaderAuthConfig } from '@/lib/reader-auth/config'
import { resetHandoffReplayCacheForTests, verifyHandoffToken } from '@/lib/reader-auth/handoff'

const SITE = 'https://docs.example.com'
const SECRET = 'h'.repeat(40)
const keys: Record<string, { privateKey: CryptoKey; pem: string }> = {}

beforeAll(async () => {
  for (const alg of ['RS256', 'ES256', 'EdDSA'] as const) {
    const pair = await generateKeyPair(alg, { extractable: true })
    keys[alg] = { privateKey: pair.privateKey, pem: await exportSPKI(pair.publicKey) }
  }
})

beforeEach(() => {
  resetHandoffReplayCacheForTests()
  vi.unstubAllEnvs()
  vi.stubEnv('THALLY_READER_JWT_SECRET', '')
  vi.stubEnv('THALLY_READER_JWT_PUBLIC_KEY', '')
  vi.stubEnv('THALLY_READER_JWKS_URL', '')
})

afterEach(() => vi.unstubAllEnvs())

const now = () => Math.floor(Date.now() / 1000)
const jwtConfig = (jwt: Record<string, unknown> = {}) => parseReaderAuthConfig({ mode: 'jwt', jwt })

function claims(overrides: Record<string, unknown> = {}) {
  return { sub: 'user-1', aud: SITE, groups: ['beta'], iat: now(), exp: now() + 60, ...overrides }
}

async function signAsym(alg: 'RS256' | 'ES256' | 'EdDSA', payload: Record<string, unknown>, header: Record<string, unknown> = {}) {
  return new SignJWT(payload).setProtectedHeader({ alg, ...header }).sign(keys[alg].privateKey)
}

async function signHs(payload: Record<string, unknown>, secret = SECRET) {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(secret))
}

describe('verifyHandoffToken with a public key', () => {
  beforeEach(() => vi.stubEnv('THALLY_READER_JWT_PUBLIC_KEY', keys.RS256.pem))

  it('accepts a valid RS256 token and extracts groups and subject', async () => {
    const result = await verifyHandoffToken(await signAsym('RS256', claims()), [SITE], jwtConfig())
    expect(result).toEqual({ isValid: true, subject: 'user-1', groups: ['beta'] })
  })

  it.each(['ES256', 'EdDSA'] as const)('accepts a valid %s token with a matching key', async (alg) => {
    vi.stubEnv('THALLY_READER_JWT_PUBLIC_KEY', keys[alg].pem)
    const result = await verifyHandoffToken(await signAsym(alg, claims()), [SITE], jwtConfig())
    expect(result.isValid).toBe(true)
  })

  it('rejects an algorithm outside the configured allowlist', async () => {
    const result = await verifyHandoffToken(await signAsym('RS256', claims()), [SITE], jwtConfig({ algorithms: ['EdDSA'] }))
    expect(result).toEqual({ isValid: false, reason: 'invalid_token' })
  })

  it('rejects alg: none', async () => {
    const unsigned = new UnsecuredJWT(claims()).encode()
    expect((await verifyHandoffToken(unsigned, [SITE], jwtConfig())).isValid).toBe(false)
  })

  it('rejects HS256 signed with the public key text (algorithm confusion)', async () => {
    const forged = await signHs(claims(), keys.RS256.pem)
    expect((await verifyHandoffToken(forged, [SITE], jwtConfig())).isValid).toBe(false)
  })

  it('rejects a token signed by a different key, and a tampered payload', async () => {
    const other = await generateKeyPair('RS256')
    const foreign = await new SignJWT(claims()).setProtectedHeader({ alg: 'RS256' }).sign(other.privateKey)
    expect((await verifyHandoffToken(foreign, [SITE], jwtConfig())).isValid).toBe(false)

    const [header, , signature] = (await signAsym('RS256', claims())).split('.')
    const tampered = Buffer.from(JSON.stringify(claims({ groups: ['admin'] }))).toString('base64url')
    expect((await verifyHandoffToken(`${header}.${tampered}.${signature}`, [SITE], jwtConfig())).isValid).toBe(false)
  })

  it('rejects an ES256 token against an RSA key (key type must match alg)', async () => {
    const result = await verifyHandoffToken(await signAsym('ES256', claims()), [SITE], jwtConfig())
    expect(result.isValid).toBe(false)
  })

  it('rejects expired, not-yet-valid, too-old, and missing-lifetime tokens', async () => {
    const config = jwtConfig({ maxTokenAgeSeconds: 60, clockSkewSeconds: 5 })
    const verify = async (payload: Record<string, unknown>) => (await verifyHandoffToken(await signAsym('RS256', payload), [SITE], config)).isValid
    expect(await verify(claims({ exp: now() - 30 }))).toBe(false)
    expect(await verify(claims({ nbf: now() + 120 }))).toBe(false)
    expect(await verify(claims({ iat: now() - 600 }))).toBe(false)
    expect(await verify(claims({ iat: now() + 600, exp: now() + 900 }))).toBe(false)
    expect(await verify({ ...claims(), exp: undefined })).toBe(false)
    expect(await verify({ ...claims(), iat: undefined })).toBe(false)
  })

  it('binds tokens to this site by default (aud or Mintlify host claim)', async () => {
    const verify = async (payload: Record<string, unknown>) => (await verifyHandoffToken(await signAsym('RS256', payload), [SITE], jwtConfig())).isValid
    expect(await verify(claims({ aud: 'https://other.example.com' }))).toBe(false)
    expect(await verify(claims({ aud: undefined }))).toBe(false)
    expect(await verify(claims({ aud: undefined, host: 'docs.example.com' }))).toBe(true)
    expect(await verify(claims({ aud: undefined, host: 'evil.example.com' }))).toBe(false)
  })

  it('enforces a configured audience and issuer', async () => {
    const config = jwtConfig({ audience: 'docs-readers', issuer: 'https://app.example.com' })
    const verify = async (payload: Record<string, unknown>) => (await verifyHandoffToken(await signAsym('RS256', payload), [SITE], config)).isValid
    expect(await verify(claims({ aud: 'docs-readers', iss: 'https://app.example.com' }))).toBe(true)
    expect(await verify(claims({ aud: SITE, iss: 'https://app.example.com' }))).toBe(false)
    expect(await verify(claims({ aud: 'docs-readers', iss: 'https://evil.example.com' }))).toBe(false)
    expect(await verify(claims({ aud: 'docs-readers' }))).toBe(false)
  })

  it('treats a missing groups claim as no groups and a malformed one as invalid', async () => {
    const verify = (payload: Record<string, unknown>, config = jwtConfig()) => signAsym('RS256', payload).then((token) => verifyHandoffToken(token, [SITE], config))
    expect(await verify(claims({ groups: undefined }))).toEqual({ isValid: true, subject: 'user-1', groups: [] })
    expect((await verify(claims({ groups: 42 }))).isValid).toBe(false)
    expect((await verify(claims({ groups: ['ok', { admin: true }] }))).isValid).toBe(false)
    expect(await verify(claims({ groups: undefined, app: { roles: ['r'] } }), jwtConfig({ groupsClaim: 'app.roles' }))).toMatchObject({ groups: ['r'] })
  })

  it('requires a jti when requireJti is set', async () => {
    const config = jwtConfig({ requireJti: true })
    expect((await verifyHandoffToken(await signAsym('RS256', claims()), [SITE], config)).isValid).toBe(false)
    expect((await verifyHandoffToken(await signAsym('RS256', claims({ jti: 'j-1' })), [SITE], config)).isValid).toBe(true)
  })

  it('splits a string groups claim only with a configured delimiter', async () => {
    const asString = claims({ groups: 'beta staff' })
    expect(await verifyHandoffToken(await signAsym('RS256', asString), [SITE], jwtConfig())).toMatchObject({ groups: ['beta staff'] })
    expect(await verifyHandoffToken(await signAsym('RS256', asString), [SITE], jwtConfig({ groupsDelimiter: ' ' }))).toMatchObject({ groups: ['beta', 'staff'] })
  })

  it('refuses to replay a token id', async () => {
    const token = await signAsym('RS256', claims({ jti: 'once' }))
    expect((await verifyHandoffToken(token, [SITE], jwtConfig())).isValid).toBe(true)
    expect(await verifyHandoffToken(token, [SITE], jwtConfig())).toEqual({ isValid: false, reason: 'replayed' })
  })

  it('passes a Mintlify expiresAt through for the session to clamp', async () => {
    const result = await verifyHandoffToken(await signAsym('RS256', claims({ expiresAt: now() + 3600 })), [SITE], jwtConfig())
    expect(result).toMatchObject({ isValid: true, expiresAt: expect.any(Number) })
  })
})

describe('verifyHandoffToken with a shared secret', () => {
  it('accepts HS256 and nothing else', async () => {
    vi.stubEnv('THALLY_READER_JWT_SECRET', SECRET)
    expect((await verifyHandoffToken(await signHs(claims()), [SITE], jwtConfig())).isValid).toBe(true)
    expect((await verifyHandoffToken(await signAsym('RS256', claims()), [SITE], jwtConfig())).isValid).toBe(false)
    expect((await verifyHandoffToken(await signHs(claims(), 'x'.repeat(40)), [SITE], jwtConfig())).isValid).toBe(false)
  })

  it('refuses a short secret and an ambiguous key configuration', async () => {
    vi.stubEnv('THALLY_READER_JWT_SECRET', 'short')
    expect(await verifyHandoffToken(await signHs(claims(), 'short'), [SITE], jwtConfig())).toEqual({ isValid: false, reason: 'misconfigured' })
    vi.stubEnv('THALLY_READER_JWT_SECRET', SECRET)
    vi.stubEnv('THALLY_READER_JWT_PUBLIC_KEY', keys.RS256.pem)
    expect(await verifyHandoffToken(await signHs(claims()), [SITE], jwtConfig())).toEqual({ isValid: false, reason: 'misconfigured' })
  })

  it('does nothing outside jwt mode or without a key', async () => {
    expect(await verifyHandoffToken('x.y.z', [SITE], jwtConfig())).toEqual({ isValid: false, reason: 'not_configured' })
    vi.stubEnv('THALLY_READER_JWT_SECRET', SECRET)
    expect(await verifyHandoffToken(await signHs(claims()), [SITE], parseReaderAuthConfig({ mode: 'oidc' }))).toEqual({ isValid: false, reason: 'not_configured' })
  })
})
