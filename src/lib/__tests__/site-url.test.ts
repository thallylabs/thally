import { describe, it, expect, afterEach } from 'vitest'
import { getHostingSiteUrl, getSiteUrl, isLoopbackUrl, siteUrlMismatch } from '@/lib/site-url'

describe('siteUrlMismatch', () => {
  afterEach(() => {
    delete process.env.THALLY_SITE_URL
    delete process.env.DOX_SITE_URL // legacy fallback name
    delete process.env.NEXT_PUBLIC_SITE_URL
  })

  it('returns null when the configured host matches the request origin', () => {
    process.env.THALLY_SITE_URL = 'https://docs.example.com'
    expect(siteUrlMismatch('https://docs.example.com/anything')).toBeNull()
  })

  it('flags a mismatch between the configured host and the request origin', () => {
    process.env.THALLY_SITE_URL = 'http://localhost:3000'
    const message = siteUrlMismatch('http://localhost:3040')
    expect(message).toContain('localhost:3000')
    expect(message).toContain('localhost:3040')
    expect(message).toContain('THALLY_SITE_URL')
  })

  it('stays quiet on Vercel previews that intentionally link to production', () => {
    process.env.VERCEL = '1'
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'docs.acme.com'
    try {
      expect(siteUrlMismatch('https://acme-git-branch.vercel.app')).toBeNull()
    } finally {
      delete process.env.VERCEL
      delete process.env.VERCEL_ENV
      delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    }
  })

  it('returns null for an unparseable request origin', () => {
    process.env.THALLY_SITE_URL = 'https://docs.example.com'
    expect(siteUrlMismatch('not-a-url')).toBeNull()
  })
})

describe('getSiteUrl', () => {
  it('keeps explicit precedence: THALLY_SITE_URL, DOX_SITE_URL, NEXT_PUBLIC_SITE_URL', () => {
    expect(getSiteUrl({ THALLY_SITE_URL: 'https://a.example', DOX_SITE_URL: 'https://b.example' })).toBe('https://a.example')
    expect(getSiteUrl({ DOX_SITE_URL: 'https://b.example', NEXT_PUBLIC_SITE_URL: 'https://c.example' })).toBe('https://b.example')
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: 'https://c.example' })).toBe('https://c.example')
  })

  it('treats empty explicit values as unset', () => {
    expect(getSiteUrl({ THALLY_SITE_URL: '  ', NEXT_PUBLIC_SITE_URL: 'https://c.example' })).toBe('https://c.example')
  })

  it('falls back to the local development URL with no configuration', () => {
    expect(getSiteUrl({})).toBe('http://localhost:3040')
  })

  it('prefers the Vercel production domain over the per-deployment URL', () => {
    const env = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'docs.acme.com', VERCEL_URL: 'acme-abc123.vercel.app' }
    expect(getSiteUrl(env)).toBe('https://docs.acme.com')
    expect(getSiteUrl({ VERCEL: '1', VERCEL_URL: 'acme-abc123.vercel.app' })).toBe('https://acme-abc123.vercel.app')
  })

  it('reads Netlify, Cloudflare Pages, and Render only behind their platform markers', () => {
    expect(getSiteUrl({ NETLIFY: 'true', URL: 'https://acme.netlify.app', DEPLOY_PRIME_URL: 'https://deploy-preview-1--acme.netlify.app' })).toBe('https://acme.netlify.app')
    expect(getSiteUrl({ NETLIFY: 'true', DEPLOY_PRIME_URL: 'https://deploy-preview-1--acme.netlify.app' })).toBe('https://deploy-preview-1--acme.netlify.app')
    expect(getSiteUrl({ URL: 'https://not-netlify.example' })).toBe('http://localhost:3040')
    expect(getSiteUrl({ CF_PAGES: '1', CF_PAGES_URL: 'https://abc.acme.pages.dev' })).toBe('https://abc.acme.pages.dev')
    expect(getSiteUrl({ RENDER: 'true', RENDER_EXTERNAL_URL: 'https://acme.onrender.com' })).toBe('https://acme.onrender.com')
  })

  it('lets an explicit public URL win over a hosting URL', () => {
    expect(getSiteUrl({ THALLY_SITE_URL: 'https://docs.acme.com', VERCEL: '1', VERCEL_URL: 'acme.vercel.app' })).toBe('https://docs.acme.com')
  })

  it('demotes a loopback explicit URL when the host publishes a real one', () => {
    expect(getSiteUrl({ THALLY_SITE_URL: 'http://localhost:3040', VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'acme.vercel.app' })).toBe('https://acme.vercel.app')
    // With no recognized host the explicit loopback value is still honored.
    expect(getSiteUrl({ THALLY_SITE_URL: 'http://localhost:4000' })).toBe('http://localhost:4000')
  })

  it('never uses hosting URLs during local development', () => {
    expect(getHostingSiteUrl({ NODE_ENV: 'development', VERCEL: '1', VERCEL_URL: 'acme.vercel.app' })).toBeUndefined()
    expect(getHostingSiteUrl({ VERCEL: '1', VERCEL_ENV: 'development', VERCEL_URL: 'localhost:3000' })).toBeUndefined()
    expect(getHostingSiteUrl({ NETLIFY: 'true', CONTEXT: 'dev', URL: 'http://localhost:8888' })).toBeUndefined()
  })

  it('ignores malformed or non-http provider values', () => {
    expect(getHostingSiteUrl({ NETLIFY: 'true', URL: 'javascript:alert(1)' })).toBeUndefined()
    expect(getHostingSiteUrl({ RENDER: 'true', RENDER_EXTERNAL_URL: 'https://acme.onrender.com/some/path' })).toBe('https://acme.onrender.com')
  })
})

describe('isLoopbackUrl', () => {
  it.each(['http://localhost:3040', 'http://docs.localhost', 'http://127.0.0.1:3000', 'http://[::1]:3040', 'http://0.0.0.0'])('treats %s as loopback', (url) => {
    expect(isLoopbackUrl(url)).toBe(true)
  })

  it.each(['https://docs.example.com', 'not a url', 'https://localhost.example.com'])('treats %s as non-loopback', (url) => {
    expect(isLoopbackUrl(url)).toBe(false)
  })
})
