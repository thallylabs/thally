import { describe, it, expect, afterEach } from 'vitest'
import { siteUrlMismatch } from '@/lib/site-url'

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

  it('returns null for an unparseable request origin', () => {
    process.env.THALLY_SITE_URL = 'https://docs.example.com'
    expect(siteUrlMismatch('not-a-url')).toBeNull()
  })
})
