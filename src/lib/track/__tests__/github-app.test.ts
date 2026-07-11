import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  buildAppManifest,
  exchangeManifestCode,
  signManifestState,
  verifyManifestState,
} from '@/lib/track/github-app'

const prevSecret = process.env.THALLY_AUTH_SECRET
const prevSiteUrl = process.env.THALLY_SITE_URL

beforeAll(() => {
  process.env.THALLY_AUTH_SECRET = 'a-sufficiently-long-test-secret'
  process.env.THALLY_SITE_URL = 'https://docs.acme.test'
})
afterAll(() => {
  if (prevSecret === undefined) delete process.env.THALLY_AUTH_SECRET
  else process.env.THALLY_AUTH_SECRET = prevSecret
  if (prevSiteUrl === undefined) delete process.env.THALLY_SITE_URL
  else process.env.THALLY_SITE_URL = prevSiteUrl
})

describe('buildAppManifest', () => {
  it('derives urls from the canonical site URL and requests least-privilege perms', () => {
    const m = buildAppManifest()
    expect(m.redirect_url).toBe('https://docs.acme.test/api/admin/github-app/callback')
    expect(m.setup_url).toBe('https://docs.acme.test/api/admin/github-app/callback')
    expect(m.hook_attributes.url).toBe('https://docs.acme.test/api/track/webhook')
    expect(m.default_events).toEqual(['pull_request'])
    expect(m.default_permissions).toMatchObject({ pull_requests: 'write', contents: 'write', metadata: 'read' })
    expect(m.public).toBe(false)
  })
  it('honors an explicit siteUrl and app name, stripping trailing slashes', () => {
    const m = buildAppManifest({ siteUrl: 'https://x.test/', appName: 'Acme Docs Bot' })
    expect(m.name).toBe('Acme Docs Bot')
    expect(m.redirect_url).toBe('https://x.test/api/admin/github-app/callback')
  })
})

describe('manifest CSRF state', () => {
  it('round-trips a signed state', () => {
    const state = signManifestState()
    expect(state).toBeTruthy()
    expect(verifyManifestState(state)).toBe(true)
  })
  it('rejects tampered, malformed, and empty states', () => {
    const state = signManifestState()!
    expect(verifyManifestState(state + 'x')).toBe(false)
    expect(verifyManifestState('a.b.c')).toBe(false)
    expect(verifyManifestState(null)).toBe(false)
  })
  it('rejects an expired state', () => {
    const state = signManifestState()!
    expect(verifyManifestState(state, -1)).toBe(false)
  })
})

describe('exchangeManifestCode', () => {
  it('POSTs the code and maps the response to credentials', async () => {
    let calledUrl = ''
    const fakeFetch = (async (url: unknown, init?: unknown) => {
      calledUrl = String(url)
      expect((init as RequestInit).method).toBe('POST')
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: 987,
          slug: 'acme-thally-track',
          html_url: 'https://github.com/apps/acme-thally-track',
          pem: '-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----',
          webhook_secret: 'whsec_abc',
        }),
      } as Response
    }) as typeof fetch
    const conv = await exchangeManifestCode('the-code', fakeFetch)
    expect(calledUrl).toContain('/app-manifests/the-code/conversions')
    expect(conv).toMatchObject({ id: 987, slug: 'acme-thally-track', webhookSecret: 'whsec_abc' })
    expect(conv.pem).toContain('BEGIN RSA PRIVATE KEY')
  })
  it('throws on a non-ok response', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response) as typeof fetch
    await expect(exchangeManifestCode('bad', fakeFetch)).rejects.toThrow(/conversion failed/i)
  })
})
