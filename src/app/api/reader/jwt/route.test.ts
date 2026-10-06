/** JWT handoff route: cookie attributes, safe return paths, login-CSRF origin checks. */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'

const config = vi.hoisted(() => ({
  auth: { mode: 'jwt', default: 'public', loginUrl: 'https://app.example.com/login' },
  tabs: [],
}))
vi.mock('@/lib/docs-json-config', () => ({ getDocsJsonConfig: () => config, getDocsJsonConfigRevision: () => 1 }))
// Groups the fixture site's content references; sessions keep only these.
vi.mock('@/data/docs', () => ({ loadReferencedReaderGroups: async () => new Set(['beta', 'g7']) }))

import { GET, POST } from './route'
import { resetHandoffReplayCacheForTests } from '@/lib/reader-auth/handoff'
import { verifyReaderSession } from '@/lib/reader-auth/session'

const SECRET = 'j'.repeat(40)
const SITE = 'https://docs.example.com'

beforeAll(() => {
  vi.stubEnv('THALLY_READER_JWT_SECRET', SECRET)
  vi.stubEnv('THALLY_READER_SESSION_SECRET', 's'.repeat(40))
  vi.stubEnv('THALLY_SITE_URL', SITE)
})
afterAll(() => vi.unstubAllEnvs())
beforeEach(() => resetHandoffReplayCacheForTests())

const token = (audience = SITE, groups: Array<string> = ['beta']) => new SignJWT({ groups })
  .setProtectedHeader({ alg: 'HS256' }).setSubject('u1').setAudience(audience).setIssuedAt().setExpirationTime('60s')
  .sign(new TextEncoder().encode(SECRET))

describe('/api/reader/jwt', () => {
  it('sets an HttpOnly, SameSite=Lax session and redirects to a same-origin path without caching or referrers', async () => {
    const response = await GET(new NextRequest(`${SITE}/api/reader/jwt?token=${await token()}&redirect=/guides/beta`))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${SITE}/guides/beta`)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    const value = /thally_reader=([^;]+)/.exec(cookie)![1]
    expect((await verifyReaderSession(value))?.groups).toEqual(['beta'])
  })

  it.each(['https://evil.example.com', '//evil.example.com', '/\\evil.example.com', '/api/reader/logout'])(
    'never redirects off-site or back into sign-in (%s)',
    async (redirect) => {
      const response = await GET(new NextRequest(`${SITE}/api/reader/jwt?token=${await token()}&redirect=${encodeURIComponent(redirect)}`))
      expect(response.headers.get('location')).toBe(`${SITE}/`)
    },
  )

  it('signs in a reader from a large directory, keeping only groups the content references', async () => {
    const directory = Array.from({ length: 200 }, (_, index) => `g${index}-${'x'.repeat(12)}`).concat('beta', 'g7')
    const response = await GET(new NextRequest(`${SITE}/api/reader/jwt?token=${await token(SITE, directory)}`))
    expect(response.status).toBe(303)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie.length).toBeLessThan(4096)
    const value = /thally_reader=([^;]+)/.exec(cookie)![1]
    expect((await verifyReaderSession(value))?.groups).toEqual(['beta', 'g7'])
  })

  it('still rejects a groups claim with a non-string member', async () => {
    const bad = await new SignJWT({ groups: ['beta', 7] }).setProtectedHeader({ alg: 'HS256' }).setSubject('u1').setAudience(SITE)
      .setIssuedAt().setExpirationTime('60s').sign(new TextEncoder().encode(SECRET))
    expect((await GET(new NextRequest(`${SITE}/api/reader/jwt?token=${bad}`))).status).toBe(401)
  })

  it('rejects an invalid token without setting a cookie', async () => {
    const response = await GET(new NextRequest(`${SITE}/api/reader/jwt?token=${await token('https://other.example.com')}`))
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('accepts a form POST from the login app origin and refuses other origins', async () => {
    const post = async (origin: string) => POST(new NextRequest(`${SITE}/api/reader/jwt`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: await token(), redirect: '/x' }).toString(),
    }))
    expect((await post('https://app.example.com')).status).toBe(303)
    const refused = await post('https://evil.example.com')
    expect(refused.status).toBe(403)
    expect(refused.headers.get('set-cookie')).toBeNull()
  })

  it('answers the fragment page with the destination as data', async () => {
    const response = await POST(new NextRequest(`${SITE}/api/reader/jwt`, {
      method: 'POST',
      headers: { origin: SITE, 'content-type': 'application/json' },
      body: JSON.stringify({ token: await token(), redirect: '/guides/beta?x=1' }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ redirect: '/guides/beta?x=1' })
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('set-cookie')).toMatch(/thally_reader=/)
  })
})
