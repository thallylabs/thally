/** The shared page-visibility rule and reader-auth config parsing. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANONYMOUS_READER,
  canReaderAccessPage,
  mergePageAccess,
  normalizeGroupsClaim,
  parsePageAccess,
  readClaim,
  readerVisibilityKey,
  type ReaderContext,
} from '@/lib/reader-auth/access'
import { parseReaderAuthConfig, resetReaderAuthConfigForTests } from '@/lib/reader-auth/config'

const beta: ReaderContext = { isAuthenticated: true, groups: ['beta'], source: 'session' }
const staff: ReaderContext = { isAuthenticated: true, groups: [], source: 'session' }
const publicSite = parseReaderAuthConfig({ mode: 'jwt', default: 'public' })
const privateSite = parseReaderAuthConfig({ mode: 'jwt' })
const noAuth = parseReaderAuthConfig(undefined)

afterEach(() => {
  resetReaderAuthConfigForTests()
  vi.restoreAllMocks()
})

describe('parsePageAccess', () => {
  it('normalizes list, string, and comma-separated groups', () => {
    expect(parsePageAccess({ groups: ['a', ' b '] }).groupSets).toEqual([['a', 'b']])
    expect(parsePageAccess({ groups: 'admin' }).groupSets).toEqual([['admin']])
    expect(parsePageAccess({ groups: 'a, b' }).groupSets).toEqual([['a', 'b']])
    expect(parsePageAccess({ groups: [] })).toEqual({ groupSets: [], isMalformed: false })
  })

  it('reads public as a strict boolean and treats anything else as malformed', () => {
    expect(parsePageAccess({ public: true }).isPublic).toBe(true)
    expect(parsePageAccess({ public: 'true' }).isPublic).toBe(true)
    expect(parsePageAccess({ public: 'no' }).isPublic).toBe(false)
    expect(parsePageAccess({ public: 0 }).isPublic).toBe(false)
    expect(parsePageAccess({ public: 'yes' }).isMalformed).toBe(true)
    expect(parsePageAccess({ public: 'maybe' }).isMalformed).toBe(true)
  })

  it('treats non-string group entries and empty names as malformed', () => {
    expect(parsePageAccess({ groups: [1] }).isMalformed).toBe(true)
    expect(parsePageAccess({ groups: { a: 1 } }).isMalformed).toBe(true)
    expect(parsePageAccess({ groups: [''] }).isMalformed).toBe(true)
  })
})

describe('canReaderAccessPage', () => {
  const page = (frontmatter: Record<string, unknown>) => parsePageAccess(frontmatter)

  it('withholds restricted pages from everyone when reader auth is not configured', () => {
    expect(canReaderAccessPage(page({}), ANONYMOUS_READER, noAuth)).toBe(true)
    expect(canReaderAccessPage(page({ public: true }), ANONYMOUS_READER, noAuth)).toBe(true)
    expect(canReaderAccessPage(page({ groups: ['beta'] }), ANONYMOUS_READER, noAuth)).toBe(false)
    expect(canReaderAccessPage(page({ public: false }), ANONYMOUS_READER, noAuth)).toBe(false)
    // A forged "authenticated" context cannot help without reader auth.
    expect(canReaderAccessPage(page({ groups: ['beta'] }), beta, noAuth)).toBe(false)
  })

  it('applies Mintlify semantics on a public-by-default site', () => {
    expect(canReaderAccessPage(page({}), ANONYMOUS_READER, publicSite)).toBe(true)
    expect(canReaderAccessPage(page({ public: false }), ANONYMOUS_READER, publicSite)).toBe(false)
    expect(canReaderAccessPage(page({ public: false }), staff, publicSite)).toBe(true)
    expect(canReaderAccessPage(page({ groups: ['beta'] }), ANONYMOUS_READER, publicSite)).toBe(false)
    expect(canReaderAccessPage(page({ groups: ['beta'] }), staff, publicSite)).toBe(false)
    expect(canReaderAccessPage(page({ groups: ['beta', 'ga'] }), beta, publicSite)).toBe(true)
  })

  it('makes unmarked pages private on a private site and lets public: true through', () => {
    expect(canReaderAccessPage(page({}), ANONYMOUS_READER, privateSite)).toBe(false)
    expect(canReaderAccessPage(page({}), staff, privateSite)).toBe(true)
    expect(canReaderAccessPage(page({ public: true }), ANONYMOUS_READER, privateSite)).toBe(true)
  })

  it('lets groups win over public: true', () => {
    expect(canReaderAccessPage(page({ public: true, groups: ['beta'] }), ANONYMOUS_READER, publicSite)).toBe(false)
  })

  it('never serves malformed access frontmatter', () => {
    expect(canReaderAccessPage(page({ public: 'maybe' }), beta, publicSite)).toBe(false)
  })
})

describe('mergePageAccess', () => {
  it('keeps the most restrictive declaration across a translation and its primary page', () => {
    const merged = mergePageAccess(parsePageAccess({ groups: ['beta'] }), parsePageAccess({ public: true }))
    expect(canReaderAccessPage(merged, ANONYMOUS_READER, publicSite)).toBe(false)
    expect(canReaderAccessPage(merged, beta, publicSite)).toBe(true)
    const both = mergePageAccess(parsePageAccess({ groups: ['beta'] }), parsePageAccess({ groups: ['ga'] }))
    expect(canReaderAccessPage(both, beta, publicSite)).toBe(false)
    expect(mergePageAccess(parsePageAccess({ public: true }), parsePageAccess({})).isPublic).toBeUndefined()
  })
})

describe('group claims', () => {
  it('accepts lists and delimited strings and rejects malformed claims outright', () => {
    expect(normalizeGroupsClaim(undefined)).toEqual([])
    expect(normalizeGroupsClaim(['a', 'a', ' b '])).toEqual(['a', 'b'])
    // A string claim is one group unless a delimiter is configured.
    expect(normalizeGroupsClaim('a b,c')).toEqual(['a b,c'])
    expect(normalizeGroupsClaim('a b c', ' ')).toEqual(['a', 'b', 'c'])
    expect(normalizeGroupsClaim('Platform Team')).toEqual(['Platform Team'])
    expect(normalizeGroupsClaim(['a', 1])).toBeNull()
    expect(normalizeGroupsClaim({})).toBeNull()
    // Directory users often hold hundreds of groups; only absurd claims are refused.
    expect(normalizeGroupsClaim(Array.from({ length: 300 }, (_, i) => `g${i}`))).toHaveLength(300)
    expect(normalizeGroupsClaim(Array.from({ length: 1001 }, (_, i) => `g${i}`))).toBeNull()
    expect(normalizeGroupsClaim(['x'.repeat(257)])).toBeNull()
  })

  it('reads namespaced claims by exact key before dotted paths', () => {
    expect(readClaim({ 'https://example.com/groups': ['a'] }, 'https://example.com/groups')).toEqual(['a'])
    expect(readClaim({ app: { roles: ['r'] } }, 'app.roles')).toEqual(['r'])
    expect(readClaim({ app: {} }, 'app.roles.deep')).toBeUndefined()
  })

  it('keys reader views only by what affects visibility', () => {
    expect(readerVisibilityKey(beta, noAuth)).toBe('anonymous')
    expect(readerVisibilityKey({ ...beta, groups: ['b', 'a'] }, publicSite)).toBe(readerVisibilityKey({ ...beta, groups: ['a', 'b'] }, publicSite))
  })
})

describe('parseReaderAuthConfig', () => {
  it('keeps password mode and an absent block on the existing behavior', () => {
    expect(noAuth).toMatchObject({ isEnabled: false, isMisconfigured: false, defaultVisibility: 'public' })
    expect(parseReaderAuthConfig({ mode: 'password' })).toMatchObject({ isEnabled: false, isMisconfigured: false })
  })

  it('fails closed on an unknown mode', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(parseReaderAuthConfig({ mode: 'jwtt' })).toMatchObject({ isEnabled: false, isMisconfigured: true, defaultVisibility: 'private' })
    expect(warn).toHaveBeenCalled()
  })

  it('defaults reader-auth sites to private and only opens them on an explicit "public"', () => {
    expect(privateSite.defaultVisibility).toBe('private')
    expect(parseReaderAuthConfig({ mode: 'oidc', default: 'Public' }).defaultVisibility).toBe('private')
    expect(publicSite.defaultVisibility).toBe('public')
  })

  it('drops none and symmetric algorithms from the asymmetric allowlist and bounds lifetimes', () => {
    const config = parseReaderAuthConfig({
      mode: 'jwt',
      jwt: { algorithms: ['none', 'HS256', 'ES256'], maxTokenAgeSeconds: 999_999, clockSkewSeconds: 9_999 },
      session: { maxAgeSeconds: 10 ** 9 },
    })
    expect(config.jwt.algorithms).toEqual(['ES256'])
    expect(config.jwt.maxTokenAgeSeconds).toBe(600)
    expect(config.jwt.clockSkewSeconds).toBe(120)
    expect(config.sessionMaxAgeSeconds).toBe(30 * 24 * 60 * 60)
  })

  it('ignores non-https login and logout URLs', () => {
    const config = parseReaderAuthConfig({ mode: 'jwt', loginUrl: 'javascript:alert(1)', logoutUrl: 'http://evil.example' })
    expect(config.loginUrl).toBeUndefined()
    expect(config.logoutUrl).toBeUndefined()
    expect(parseReaderAuthConfig({ mode: 'jwt', loginUrl: 'https://app.example.com/login' }).loginUrl).toBe('https://app.example.com/login')
  })
})

describe('unparseable frontmatter marker', () => {
  it('treats a content index entry flagged as unparseable as malformed (served to nobody)', () => {
    const access = parsePageAccess({ __thallyFrontmatterError: true })
    expect(access.isMalformed).toBe(true)
    expect(canReaderAccessPage(access, beta, publicSite)).toBe(false)
  })
})

describe('get-doc module', () => {
  it('is not a Server Action module (no unauthenticated action endpoint)', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('src/data/get-doc.ts', 'utf8')).not.toMatch(/^\s*['"]use server['"]/m)
  })
})
