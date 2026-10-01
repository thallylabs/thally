import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The renderer's validator is the other half of this contract.
import { resolveAnalyticsConfig } from '../../../../src/lib/analytics-config'

import { projectMintlifyIntegrations } from '../analytics.js'
import { migrateRepository, mergeMigrationConfig } from '../index.js'

const KEY = `phc_${'a1B2'.repeat(8)}`

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())
const project = (config: Record<string, unknown>) => projectMintlifyIntegrations(config)
const text = (result: ReturnType<typeof project>) => result.warnings.map((w) => w.message).join('\n')

describe('Mintlify analytics projection', () => {
  it('maps every supported docs.json integrations field', () => {
    const result = project({
      integrations: {
        ga4: { measurementId: ' G-TEST12345 ' },
        gtm: { tagId: 'GTM-TEST123' },
        posthog: { apiKey: KEY, apiHost: 'https://eu.i.posthog.com/', sessionRecording: false },
        plausible: { domain: 'Docs.Example.com, example.org', server: 'plausible.example.com' },
      },
    })
    expect(result.integrations).toEqual({
      ga4: { measurementId: 'G-TEST12345' },
      gtm: { tagId: 'GTM-TEST123' },
      posthog: { apiKey: KEY, apiHost: 'https://eu.i.posthog.com', sessionRecording: false },
      plausible: { domain: 'docs.example.com,example.org', server: 'plausible.example.com' },
    })
    expect(result.warnings).toEqual([])
  })

  it('maps legacy mint.json analytics, including the googleAnalytics spelling', () => {
    expect(project({ analytics: { ga4: { measurementId: 'G-LEGACY123' }, posthog: { apiKey: KEY } } }).integrations)
      .toEqual({ ga4: { measurementId: 'G-LEGACY123' }, posthog: { apiKey: KEY } })
    expect(project({ analytics: { googleAnalytics: { measurementId: 'G-ALIAS1234' } } }))
      .toEqual({ integrations: { ga4: { measurementId: 'G-ALIAS1234' } }, warnings: [] })
  })

  it('lets integrations win per provider over legacy analytics and warns', () => {
    const result = project({
      integrations: { ga4: { measurementId: 'G-NEWID1234' } },
      analytics: { ga4: { measurementId: 'G-OLDID1234' }, plausible: { domain: 'docs.example.com' } },
    })
    expect(result.integrations).toEqual({
      ga4: { measurementId: 'G-NEWID1234' },
      plausible: { domain: 'docs.example.com' },
    })
    expect(text(result)).toMatch(/integrations\.ga4 and analytics\.ga4 are both set/)
  })

  it.each([
    ['lowercase GA4', { ga4: { measurementId: 'g-test12345' } }],
    ['Universal Analytics', { ga4: { measurementId: 'UA-12345-1' } }],
    ['script injection', { ga4: { measurementId: 'G-X");alert(1);//' } }],
    ['closing script tag', { gtm: { tagId: 'GTM-A</script>' } }],
    ['unicode lookalike', { ga4: { measurementId: 'G-ТEST1234' } }],
    ['lowercase GTM', { gtm: { tagId: 'gtm-abcd123' } }],
    ['posthog personal key', { posthog: { apiKey: 'phx_' + 'a'.repeat(30) } }],
    ['posthog javascript host', { posthog: { apiKey: KEY, apiHost: 'javascript:alert(1)' } }],
    ['posthog http host', { posthog: { apiKey: KEY, apiHost: 'http://eu.i.posthog.com' } }],
    ['posthog credentials host', { posthog: { apiKey: KEY, apiHost: 'https://user:pw@evil.example' } }],
    ['posthog traversal host', { posthog: { apiKey: KEY, apiHost: 'https://x.example/../admin' } }],
    ['posthog query host', { posthog: { apiKey: KEY, apiHost: 'https://x.example/?a=1' } }],
    ['plausible url as domain', { plausible: { domain: 'https://docs.example.com' } }],
    ['plausible path domain', { plausible: { domain: 'docs.example.com/x' } }],
    ['plausible quote domain', { plausible: { domain: 'a.com" onload="x' } }],
    ['plausible bad server', { plausible: { domain: 'docs.example.com', server: 'javascript:alert(1)' } }],
    ['plausible http server', { plausible: { domain: 'docs.example.com', server: 'http://p.example.com' } }],
  ])('skips %s with a warning and never emits it', (_name, integrations) => {
    const result = project({ integrations })
    expect(result.integrations).toBeUndefined()
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(text(result)).not.toContain(KEY)
    expect(text(result)).not.toContain('alert(1);//')
  })

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['number', 12345],
    ['array', ['G-TEST12345']],
    ['object', { id: 'G-TEST12345' }],
    ['null', null],
    ['huge string', 'G-' + 'A'.repeat(1_000_000)],
  ])('does not crash on a %s measurementId and warns', (_name, value) => {
    const result = project({ integrations: { ga4: { measurementId: value } } })
    expect(result.integrations).toBeUndefined()
    expect(result.warnings).toHaveLength(1)
    expect(text(result).length).toBeLessThan(400)
  })

  it.each([
    ['string', 'G-TEST12345'],
    ['number', 5],
    ['array', []],
    ['null', null],
  ])('warns when a provider block is a %s instead of an object', (_name, value) => {
    const result = project({ integrations: { ga4: value } })
    expect(result.integrations).toBeUndefined()
    expect(result.warnings).toHaveLength(1)
  })

  it('warns when integrations itself has the wrong type', () => {
    for (const bad of ['x', 3, [], null]) {
      const result = project({ integrations: bad })
      expect(result.integrations).toBeUndefined()
      expect(result.warnings).toHaveLength(1)
    }
  })

  it('imports nothing and stays silent when neither block exists', () => {
    expect(project({ name: 'x' })).toEqual({ warnings: [] })
  })

  it('keeps a valid provider when a sibling is invalid', () => {
    const result = project({ integrations: { ga4: { measurementId: 'nope' }, gtm: { tagId: 'GTM-TEST123' } } })
    expect(result.integrations).toEqual({ gtm: { tagId: 'GTM-TEST123' } })
    expect(result.warnings).toHaveLength(1)
  })

  it('skips PostHog entirely when a self-hosted apiHost is invalid rather than falling back to another region', () => {
    const result = project({ integrations: { posthog: { apiKey: KEY, apiHost: 'ftp://h.example' } } })
    expect(result.integrations).toBeUndefined()
  })

  it('reports every unsupported provider once, by name, without values', () => {
    const result = project({
      integrations: {
        ga4: { measurementId: 'G-TEST12345' },
        amplitude: { apiKey: 'SECRETSECRET' },
        mixpanel: { projectToken: 'SECRETSECRET' },
        segment: { key: 'SECRETSECRET' },
        telemetry: { enabled: false },
        intercom: { appId: 'abcdef' },
      },
      analytics: { hotjar: { hjid: '1', hjsv: '6' }, koala: { publicApiKey: 'k' } },
    })
    const unsupported = result.warnings.filter((w) => w.message.includes('cannot render'))
    expect(unsupported).toHaveLength(1)
    for (const name of ['amplitude', 'mixpanel', 'segment', 'telemetry', 'intercom', 'hotjar', 'koala']) {
      expect(unsupported[0].message).toContain(name)
    }
    expect(text(result)).not.toContain('SECRETSECRET')
    expect(result.integrations).toEqual({ ga4: { measurementId: 'G-TEST12345' } })
  })

  it('truncates values echoed in warnings', () => {
    const result = project({ integrations: { posthog: { apiKey: `phx_${'S'.repeat(40)}` } } })
    expect(text(result)).not.toContain('S'.repeat(10))
    expect(text(result)).toContain('phx_...')
  })

  it('is not affected by prototype-pollution keys', () => {
    const config = JSON.parse(
      '{"integrations":{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"ga4":{"measurementId":"G-TEST12345","__proto__":{"y":1}}}}',
    ) as Record<string, unknown>
    const result = project(config)
    expect(result.integrations).toEqual({ ga4: { measurementId: 'G-TEST12345' } })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).y).toBeUndefined()
    expect(text(result)).toContain('__proto__')
    expect(Object.getPrototypeOf(result.integrations)).toBe(Object.prototype)
  })

  it('does not echo hostile provider names verbatim', () => {
    const result = project({ integrations: { ['x"><script>']: { a: 1 } } })
    expect(text(result)).not.toContain('<script>')
    expect(text(result)).toContain('(invalid name)')
  })
})

describe('Mintlify analytics through the repository migration', () => {
  it('writes integrations to docsConfig and surfaces warnings', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-migrate-analytics-'))
    writeFileSync(join(root, 'intro.mdx'), '---\ntitle: Intro\n---\n\nHello')
    writeFileSync(join(root, 'docs.json'), JSON.stringify({
      $schema: 'https://mintlify.com/docs.json',
      navigation: { pages: ['intro'] },
      integrations: { ga4: { measurementId: 'G-TEST12345' }, posthog: { apiKey: 'bad' }, amplitude: { apiKey: 'k' } },
    }))
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs' })
    expect(bundle.docsConfig.integrations).toEqual({ ga4: { measurementId: 'G-TEST12345' } })
    expect(bundle.warnings.some((w) => w.message.includes('amplitude'))).toBe(true)
    expect(bundle.warnings.some((w) => w.message.includes('posthog.apiKey'))).toBe(true)
  })

  it('reads legacy mint.json analytics', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-migrate-analytics-legacy-'))
    writeFileSync(join(root, 'intro.mdx'), '---\ntitle: Intro\n---\n\nHello')
    writeFileSync(join(root, 'mint.json'), JSON.stringify({
      name: 'Acme',
      navigation: [{ group: 'Docs', pages: ['intro'] }],
      analytics: { gtm: { tagId: 'GTM-TEST123' } },
    }))
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs' })
    expect(bundle.docsConfig.integrations).toEqual({ gtm: { tagId: 'GTM-TEST123' } })
  })

  it('merges into an existing site per provider, existing winning', () => {
    const merged = mergeMigrationConfig(
      { tabs: [], integrations: { ga4: { measurementId: 'G-EXISTING1' } } },
      { tabs: [], integrations: { ga4: { measurementId: 'G-INCOMING1' }, gtm: { tagId: 'GTM-TEST123' } } },
    )
    expect(merged.integrations).toEqual({ ga4: { measurementId: 'G-EXISTING1' }, gtm: { tagId: 'GTM-TEST123' } })
  })
})

describe('renderer and migrator agree (src/lib/analytics-config.ts)', () => {
  const inputs: Array<Record<string, unknown>> = [
    { ga4: { measurementId: 'G-TEST12345' } },
    { ga4: { measurementId: ' g-test12345 ' } },
    { ga4: { measurementId: 'UA-1-1' } },
    { gtm: { tagId: 'GTM-TEST123' } },
    { gtm: { tagId: 'GTM-' } },
    { posthog: { apiKey: KEY } },
    { posthog: { apiKey: KEY, apiHost: 'https://eu.i.posthog.com/' } },
    { posthog: { apiKey: KEY, apiHost: 'https://ph.example.com/ingest' } },
    { posthog: { apiKey: KEY, apiHost: 'http://ph.example.com' } },
    { posthog: { apiKey: KEY, apiHost: 'https://u:p@ph.example.com' } },
    { posthog: { apiKey: KEY, apiHost: 'https://ph.example.com/../x' } },
    { posthog: { apiKey: 'phc_short' } },
    { posthog: { apiKey: KEY, apiHost: '' } },
    { posthog: { apiKey: KEY, apiHost: null } },
    { posthog: { apiKey: KEY, apiHost: '  ' } },
    { posthog: { apiKey: KEY, sessionRecording: null } },
    { posthog: { apiKey: KEY, sessionRecording: 'false' } },
    { plausible: { domain: 'Docs.Example.com,example.org' } },
    { plausible: { domain: 'https://docs.example.com' } },
    { plausible: { domain: 'docs.example.com', server: 'plausible.example.com' } },
    { plausible: { domain: 'docs.example.com', server: 'https://plausible.example.com' } },
    { plausible: { domain: 'docs.example.com', server: 'plausible.example.com:8443' } },
    { plausible: { domain: 'docs.example.com', server: 'http://p.example.com' } },
    { plausible: { domain: 'docs.example.com', server: 'p.example.com/js' } },
    { plausible: { domain: 'docs.example.com', server: '' } },
    { plausible: { domain: 'docs.example.com', server: null } },
    { ga4: { measurementId: 5 }, gtm: [] },
  ]
  it.each(inputs)('%j', (integrations) => {
    const migrated = projectMintlifyIntegrations({ integrations }).integrations
    const rendered = resolveAnalyticsConfig(undefined, migrated)
    const direct = resolveAnalyticsConfig(undefined, integrations)
    // Whatever the migrator emits must be accepted verbatim by the renderer,
    // and anything the renderer accepts directly must survive migration.
    expect(Object.keys(rendered).sort()).toEqual(Object.keys(migrated ?? {}).sort())
    expect(Object.keys(direct).sort()).toEqual(Object.keys(rendered).sort())
    expect(direct).toEqual(rendered)
  })
})

describe('hostile input table', () => {
  const big = 'x'.repeat(100_000)
  const SECRET = 'ZZSECRETZZ'
  const values: Array<[string, unknown]> = [
    ['undefined', undefined], ['null', null], ['number', 7], ['NaN', NaN], ['true', true], ['false', false],
    ['array', []], ['array of strings', ['G-TEST12345']], ['empty string', ''], ['empty object', {}],
    ['long string', big], ['NUL', `${SECRET}\u0000`], ['line separators', 'a\u2028\u2029b'], ['script close', '</script>'],
    ['null-prototype', Object.assign(Object.create(null), { measurementId: 'bad' })],
    ['frozen', Object.freeze({ measurementId: 'bad' })],
    ['proto key', JSON.parse('{"__proto__":{"measurementId":"bad"}}')],
    ['constructor key', JSON.parse('{"constructor":{"prototype":{}}}')],
    ['throwing getter', Object.defineProperty({}, 'measurementId', { get() { throw new Error('boom') }, enumerable: true })],
    ['revoked proxy', (() => { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy })()],
    ['bigint', BigInt(10)],
  ]
  const fields = ['measurementId', 'tagId', 'domain', 'server', 'apiKey', 'apiHost', 'sessionRecording']
  const shapes = (value: unknown): Array<Record<string, unknown>> => {
    const out: Array<Record<string, unknown>> = [
      { integrations: value }, { analytics: value }, { integrations: { [`${SECRET}-`.repeat(8)]: value }, analytics: { [`${SECRET}\u0000`]: value } },
    ]
    for (const source of ['integrations', 'analytics']) {
      for (const provider of ['ga4', 'gtm', 'plausible', 'posthog', 'googleAnalytics']) {
        out.push({ [source]: { [provider]: value } })
        for (const field of fields) out.push({ [source]: { [provider]: { [field]: value } } })
      }
    }
    return out
  }

  it.each(values)('%s: no throw, no provider, no echo', (name, value) => {
    for (const config of shapes(value)) {
      let result: ReturnType<typeof project> = { warnings: [] }
      expect(() => { result = project(config) }).not.toThrow()
      expect(() => JSON.stringify(result)).not.toThrow()
      expect(result.integrations).toBeUndefined()
      const warned = text(result)
      expect(warned).not.toContain(SECRET)
      expect(warned).not.toContain('xxxxxxxx')
      expect(warned).not.toContain('</script>')
      expect([...warned].some((c) => c === String.fromCharCode(0) || c === String.fromCharCode(0x2028) || c === String.fromCharCode(0x2029))).toBe(false)
      // Whatever the migrator accepts the renderer accepts identically (nothing, here).
      expect(resolveAnalyticsConfig(undefined, result.integrations)).toEqual({})
    }
    void name
  })

  it('tolerates a non-object top-level config', () => {
    for (const bad of [null, undefined, 5, 'x', true, [], [1], BigInt(10)]) {
      expect(() => project(bad as never)).not.toThrow()
      expect(project(bad as never).integrations).toBeUndefined()
    }
  })

  it('never echoes a hostile provider key', () => {
    const result = project({ integrations: { ga4: { measurementId: 'G-TEST12345' }, [`${SECRET}\u0000x`]: {}, '__proto__x': {} } })
    expect(result.integrations).toEqual({ ga4: { measurementId: 'G-TEST12345' } })
    expect(text(result)).not.toContain(SECRET)
  })

  it('does not turn a malformed existing integrations value into character keys on merge', () => {
    for (const bad of ['abc', ['G-TEST12345'], 7]) {
      const merged = mergeMigrationConfig(
        { tabs: [], integrations: bad } as never,
        { tabs: [], integrations: { gtm: { tagId: 'GTM-TEST123' } } },
      )
      expect(merged.integrations).toEqual({ gtm: { tagId: 'GTM-TEST123' } })
    }
  })
})
