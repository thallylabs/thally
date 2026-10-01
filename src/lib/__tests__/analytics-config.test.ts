import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AnalyticsProvider, GtmNoScript } from '../../components/analytics/analytics-provider'

import {
  buildAnalyticsScripts,
  gtmNoScriptUrl,
  resetAnalyticsWarningsForTests,
  resolveAnalyticsConfig,
  type ResolvedAnalytics,
} from '../analytics-config'

const KEY = `phc_${'a1B2'.repeat(8)}`

beforeEach(() => {
  resetAnalyticsWarningsForTests()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('analytics precedence', () => {
  it('returns nothing when no source is configured', () => {
    expect(resolveAnalyticsConfig(undefined, undefined)).toEqual({})
  })

  it('keeps existing site.ts analytics working with unchanged defaults', () => {
    expect(resolveAnalyticsConfig({
      googleAnalyticsId: 'G-XXXXXXXXXX',
      plausibleDomain: 'docs.example.com',
      posthogKey: KEY,
    }, undefined)).toEqual({
      ga4: { measurementId: 'G-XXXXXXXXXX' },
      plausible: { domain: 'docs.example.com', scriptUrl: 'https://plausible.io/js/script.js' },
      posthog: { apiKey: KEY, apiHost: 'https://us.i.posthog.com', sessionRecording: true },
    })
  })

  it('honours site.ts custom Plausible script and PostHog host', () => {
    const out = resolveAnalyticsConfig({
      plausibleDomain: 'docs.example.com',
      plausibleScriptUrl: 'https://stats.example.com/js/script.js',
      posthogKey: KEY,
      posthogHost: 'https://ph.example.com/ingest',
    }, undefined)
    expect(out.plausible?.scriptUrl).toBe('https://stats.example.com/js/script.js')
    expect(out.posthog?.apiHost).toBe('https://ph.example.com/ingest')
  })

  it('fills providers site.ts does not set from docs.json', () => {
    const out = resolveAnalyticsConfig(
      { googleAnalyticsId: 'G-SITE12345' },
      { gtm: { tagId: 'GTM-TEST123' }, posthog: { apiKey: KEY, apiHost: 'https://eu.i.posthog.com', sessionRecording: false } },
    )
    expect(out.ga4?.measurementId).toBe('G-SITE12345')
    expect(out.gtm?.tagId).toBe('GTM-TEST123')
    expect(out.posthog).toEqual({ apiKey: KEY, apiHost: 'https://eu.i.posthog.com', sessionRecording: false })
  })

  it('lets site.ts win per provider and never mixes fields across sources', () => {
    const out = resolveAnalyticsConfig(
      { posthogKey: KEY },
      { posthog: { apiKey: `phc_${'z'.repeat(30)}`, apiHost: 'https://eu.i.posthog.com', sessionRecording: false }, ga4: { measurementId: 'G-DOCS12345' } },
    )
    expect(out.posthog).toEqual({ apiKey: KEY, apiHost: 'https://us.i.posthog.com', sessionRecording: true })
    expect(out.ga4?.measurementId).toBe('G-DOCS12345')
  })

  it.each([
    ['UA id', { googleAnalyticsId: 'UA-12345-1' }, 'ga4', { measurementId: 'UA-12345-1' }],
    ['lowercase id', { googleAnalyticsId: 'g-abc123' }, 'ga4', { measurementId: 'g-abc123' }],
    ['http PostHog host', { posthogKey: 'phc_short', posthogHost: 'http://ph.local:8000/' }, 'posthog',
      { apiKey: 'phc_short', apiHost: 'http://ph.local:8000/', sessionRecording: true }],
    ['plain plausible script url', { plausibleDomain: 'Docs.Example.com', plausibleScriptUrl: 'http://x/js/s.js?a=1' }, 'plausible',
      { domain: 'Docs.Example.com', scriptUrl: 'http://x/js/s.js?a=1' }],
  ] as Array<[string, Record<string, string>, keyof ResolvedAnalytics, unknown]>)(
    'renders trusted site.ts values as written: %s',
    (_name, site, provider, expected) => {
      expect(resolveAnalyticsConfig(site, undefined)[provider]).toEqual(expected)
      expect(console.warn).not.toHaveBeenCalled()
    },
  )

  it('rejects the same values when they come from docs.json', () => {
    expect(resolveAnalyticsConfig(undefined, { ga4: { measurementId: 'UA-12345-1' } }).ga4).toBeUndefined()
    expect(resolveAnalyticsConfig(undefined, { ga4: { measurementId: 'g-abc123' } }).ga4).toBeUndefined()
    expect(resolveAnalyticsConfig(undefined, { posthog: { apiKey: KEY, apiHost: 'http://ph.local' } }).posthog).toBeUndefined()
  })

  it('site.ts still wins per provider even with an unusual value', () => {
    const out = resolveAnalyticsConfig({ googleAnalyticsId: 'UA-12345-1' }, { ga4: { measurementId: 'G-DOCS12345' } })
    expect(out.ga4?.measurementId).toBe('UA-12345-1')
  })

  it('maps docs.json plausible.server to the script URL', () => {
    expect(resolveAnalyticsConfig(undefined, { plausible: { domain: 'docs.example.com', server: 'plausible.example.com' } }).plausible)
      .toEqual({ domain: 'docs.example.com', scriptUrl: 'https://plausible.example.com/js/script.js' })
    expect(resolveAnalyticsConfig(undefined, { plausible: { domain: 'docs.example.com' } }).plausible?.scriptUrl)
      .toBe('https://plausible.io/js/script.js')
  })

  it('enables every provider at once', () => {
    const out = resolveAnalyticsConfig(undefined, {
      ga4: { measurementId: 'G-TEST12345' },
      gtm: { tagId: 'GTM-TEST123' },
      posthog: { apiKey: KEY },
      plausible: { domain: 'docs.example.com' },
    })
    expect(Object.keys(out).sort()).toEqual(['ga4', 'gtm', 'plausible', 'posthog'])
  })
})

describe('analytics validation', () => {
  const cases: Array<[string, unknown, keyof ResolvedAnalytics, boolean]> = [
    ['valid GA4', { ga4: { measurementId: 'G-TEST12345' } }, 'ga4', true],
    ['GA4 padded', { ga4: { measurementId: '  G-TEST12345 ' } }, 'ga4', true],
    ['GA4 lowercase', { ga4: { measurementId: 'g-test12345' } }, 'ga4', false],
    ['GA4 UA id', { ga4: { measurementId: 'UA-12345-1' } }, 'ga4', false],
    ['GA4 injection', { ga4: { measurementId: 'G-X");alert(1);//' } }, 'ga4', false],
    ['GA4 script close', { ga4: { measurementId: 'G-ABCD</script>' } }, 'ga4', false],
    ['GA4 unicode lookalike', { ga4: { measurementId: 'G-ТEST1234' } }, 'ga4', false],
    ['GA4 too short', { ga4: { measurementId: 'G-AB' } }, 'ga4', false],
    ['GA4 number', { ga4: { measurementId: 12345 } }, 'ga4', false],
    ['GA4 array', { ga4: { measurementId: ['G-TEST12345'] } }, 'ga4', false],
    ['GA4 block string', { ga4: 'G-TEST12345' }, 'ga4', false],
    ['GA4 newline', { ga4: { measurementId: 'G-TEST12345\nfoo' } }, 'ga4', false],
    ['valid GTM', { gtm: { tagId: 'GTM-TEST123' } }, 'gtm', true],
    ['GTM lowercase', { gtm: { tagId: 'gtm-test123' } }, 'gtm', false],
    ['GTM injection', { gtm: { tagId: "GTM-A'+alert(1)+'" } }, 'gtm', false],
    ['GTM GA id', { gtm: { tagId: 'G-TEST12345' } }, 'gtm', false],
    ['valid PostHog', { posthog: { apiKey: KEY } }, 'posthog', true],
    ['PostHog personal key', { posthog: { apiKey: `phx_${'a'.repeat(30)}` } }, 'posthog', false],
    ['PostHog injection', { posthog: { apiKey: "phc_a');alert(1);//aaaaaaaaaaaaaaaaaaaa" } }, 'posthog', false],
    ['PostHog javascript host', { posthog: { apiKey: KEY, apiHost: 'javascript:alert(1)' } }, 'posthog', false],
    ['PostHog http host', { posthog: { apiKey: KEY, apiHost: 'http://eu.i.posthog.com' } }, 'posthog', false],
    ['PostHog credentials', { posthog: { apiKey: KEY, apiHost: 'https://a:b@evil.example' } }, 'posthog', false],
    ['PostHog traversal', { posthog: { apiKey: KEY, apiHost: 'https://ph.example.com/a/../b' } }, 'posthog', false],
    ['PostHog encoded traversal', { posthog: { apiKey: KEY, apiHost: 'https://ph.example.com/%2e%2e/b' } }, 'posthog', false],
    ['PostHog query', { posthog: { apiKey: KEY, apiHost: 'https://ph.example.com/?x=1' } }, 'posthog', false],
    ['PostHog fragment', { posthog: { apiKey: KEY, apiHost: 'https://ph.example.com/#x' } }, 'posthog', false],
    ['PostHog quote host', { posthog: { apiKey: KEY, apiHost: "https://ph.example.com/'x" } }, 'posthog', false],
    ['PostHog backslash', { posthog: { apiKey: KEY, apiHost: 'https://ph.example.com\\@evil.example' } }, 'posthog', false],
    ['PostHog host object', { posthog: { apiKey: KEY, apiHost: {} } }, 'posthog', false],
    ['valid Plausible', { plausible: { domain: 'docs.example.com' } }, 'plausible', true],
    ['Plausible multi-domain', { plausible: { domain: 'docs.example.com, example.org' } }, 'plausible', true],
    ['Plausible uppercase', { plausible: { domain: 'Docs.Example.COM' } }, 'plausible', true],
    ['Plausible protocol', { plausible: { domain: 'https://docs.example.com' } }, 'plausible', false],
    ['Plausible path', { plausible: { domain: 'docs.example.com/blog' } }, 'plausible', false],
    ['Plausible quote', { plausible: { domain: 'a.com" onload="alert(1)' } }, 'plausible', false],
    ['Plausible unicode', { plausible: { domain: 'dоcs.example.com' } }, 'plausible', false],
    ['Plausible empty part', { plausible: { domain: 'a.com,,b.com' } }, 'plausible', false],
    ['Plausible too many', { plausible: { domain: Array.from({ length: 11 }, (_, i) => `a${i}.com`).join(',') } }, 'plausible', false],
    ['Plausible javascript server', { plausible: { domain: 'docs.example.com', server: 'javascript:alert(1)' } }, 'plausible', false],
    ['Plausible http server', { plausible: { domain: 'docs.example.com', server: 'http://p.example.com' } }, 'plausible', false],
    ['Plausible server path', { plausible: { domain: 'docs.example.com', server: 'p.example.com/evil.js' } }, 'plausible', false],
    ['Plausible server https origin', { plausible: { domain: 'docs.example.com', server: 'https://p.example.com' } }, 'plausible', true],
    ['huge value', { ga4: { measurementId: 'G-' + 'A'.repeat(1_000_000) } }, 'ga4', false],
  ]
  it.each(cases)('%s', (_name, integrations, provider, valid) => {
    const out = resolveAnalyticsConfig(undefined, integrations)
    expect(Boolean(out[provider])).toBe(valid)
    if (!valid) expect(buildAnalyticsScripts(out)).toEqual([])
  })

  it.each(['', null, '  '])('skips PostHog, with a warning, for a present empty apiHost %j', (apiHost) => {
    expect(resolveAnalyticsConfig(undefined, { posthog: { apiKey: KEY, apiHost } }).posthog).toBeUndefined()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('integrations.posthog'))
  })

  it.each(['', null])('skips Plausible, with a warning, for a present empty server %j', (server) => {
    expect(resolveAnalyticsConfig(undefined, { plausible: { domain: 'docs.example.com', server } }).plausible).toBeUndefined()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('integrations.plausible'))
  })

  it('still defaults an absent apiHost and server', () => {
    expect(resolveAnalyticsConfig(undefined, { posthog: { apiKey: KEY } }).posthog?.apiHost).toBe('https://us.i.posthog.com')
    expect(resolveAnalyticsConfig(undefined, { plausible: { domain: 'docs.example.com' } }).plausible?.scriptUrl)
      .toBe('https://plausible.io/js/script.js')
  })

  it.each([
    ['ga4', { ga4: { measurementId: '' } }],
    ['gtm', { gtm: { tagId: null } }],
    ['posthog', { posthog: { apiKey: '' } }],
    ['plausible', { plausible: { domain: null } }],
  ])('warns when the required %s field is present but empty', (provider, integrations) => {
    expect(resolveAnalyticsConfig(undefined, integrations)).toEqual({})
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`integrations.${provider}`))
  })

  it('never throws or pollutes on hostile integrations shapes', () => {
    for (const bad of [null, 5, 'x', [], [1], { ga4: null }, { ga4: [] }, { __proto__: { ga4: { measurementId: 'G-TEST12345' } } }]) {
      expect(() => resolveAnalyticsConfig(undefined, bad)).not.toThrow()
    }
    const hostile = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}},"ga4":{"measurementId":"G-TEST12345"}}')
    expect(resolveAnalyticsConfig(undefined, hostile)).toEqual({ ga4: { measurementId: 'G-TEST12345' } })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('does not echo rejected values in warnings', () => {
    resolveAnalyticsConfig(undefined, { posthog: { apiKey: `phx_SECRET${'S'.repeat(30)}` } })
    const logged = vi.mocked(console.warn).mock.calls.flat().join(' ')
    expect(logged).toContain('posthog')
    expect(logged).not.toContain('SECRET')
  })
})

describe('analytics script plan', () => {
  const all = resolveAnalyticsConfig(undefined, {
    ga4: { measurementId: 'G-TEST12345' },
    gtm: { tagId: 'GTM-TEST123' },
    posthog: { apiKey: KEY, apiHost: 'https://eu.i.posthog.com' },
    plausible: { domain: 'docs.example.com', server: 'plausible.example.com' },
  })

  it('emits exactly one loader per provider, each id once', () => {
    const scripts = buildAnalyticsScripts(all)
    const ids = scripts.map((s) => s.key)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(['ga-init', 'ga-loader', 'gtm-init', 'plausible-loader', 'posthog-init'])
    // src-only loaders keep origin/main's attributes: no DOM id (next/script dedupes by src).
    expect(scripts.filter((s) => s.src).every((s) => s.id === undefined)).toBe(true)
    expect(scripts.filter((s) => s.src?.includes('googletagmanager.com/gtag/js'))).toHaveLength(1)
    expect(scripts.filter((s) => s.inline?.includes('gtm.js'))).toHaveLength(1)
    expect(scripts.filter((s) => s.inline?.includes('posthog.init'))).toHaveLength(1)
    expect(scripts.find((s) => s.key === 'plausible-loader')).toMatchObject({
      src: 'https://plausible.example.com/js/script.js',
      attrs: { 'data-domain': 'docs.example.com' },
    })
  })

  it('embeds values as JSON string literals', () => {
    const scripts = buildAnalyticsScripts(all)
    expect(scripts.find((s) => s.key === 'ga-init')?.inline).toContain(`gtag('config', "G-TEST12345")`)
    expect(scripts.find((s) => s.key === 'gtm-init')?.inline).toContain(`'dataLayer',"GTM-TEST123")`)
    expect(scripts.find((s) => s.key === 'posthog-init')?.inline).toContain(
      `posthog.init("${KEY}", {"api_host":"https://eu.i.posthog.com","person_profiles":"identified_only"});`,
    )
  })

  it('disables session recording only when docs.json says false', () => {
    const off = resolveAnalyticsConfig(undefined, { posthog: { apiKey: KEY, sessionRecording: false } })
    expect(buildAnalyticsScripts(off)[0].inline).toContain('"disable_session_recording":true')
    expect(buildAnalyticsScripts(all).find((s) => s.key === 'posthog-init')?.inline).not.toContain('disable_session_recording')
  })

  it('serialises unusual trusted site.ts values safely without changing them', () => {
    const scripts = buildAnalyticsScripts(resolveAnalyticsConfig({ googleAnalyticsId: '</script>"\u2028', posthogKey: "k');x(//" }, undefined))
    const inline = scripts.map((s) => s.inline ?? '').join('\n')
    expect(inline).not.toContain('</script>')
    expect(inline).not.toContain('\u2028')
    expect(inline).toContain('\\u003c/script>')
    expect(inline).toContain(`posthog.init("k');x(//"`)
  })

  it('renders no scripts for an empty config', () => {
    expect(buildAnalyticsScripts({})).toEqual([])
    expect(gtmNoScriptUrl({})).toBeNull()
  })

  it('builds the GTM noscript iframe URL only when GTM is configured', () => {
    expect(gtmNoScriptUrl(all)).toBe('https://www.googletagmanager.com/ns.html?id=GTM-TEST123')
    expect(gtmNoScriptUrl(resolveAnalyticsConfig(undefined, { ga4: { measurementId: 'G-TEST12345' } }))).toBeNull()
  })

  it('only ever contacts hosts for configured providers', () => {
    const only = resolveAnalyticsConfig(undefined, { plausible: { domain: 'docs.example.com' } })
    const serialized = JSON.stringify(buildAnalyticsScripts(only))
    expect(serialized).not.toMatch(/googletagmanager|posthog/)
  })
})

describe('hostile input table', () => {
  const big = 'x'.repeat(100_000)
  const hostileValues: Array<[string, unknown]> = [
    ['undefined', undefined], ['null', null], ['number', 7], ['NaN', NaN], ['true', true], ['false', false],
    ['array', []], ['array of strings', ['G-TEST12345']], ['string', 'G-TEST12345'], ['empty string', ''],
    ['empty object', {}], ['nested object', { a: { b: 1 } }], ['long string', big],
    ['NUL', 'G-TEST\u00001234'], ['line separators', 'G-TEST\u2028\u20291234'], ['script close', '</script><script>x</script>'],
    ['null-prototype object', Object.assign(Object.create(null), { measurementId: 'G-TEST12345' })],
    ['frozen object', Object.freeze({ measurementId: 'bad' })],
    ['proto key', JSON.parse('{"__proto__":{"measurementId":"G-TEST12345"}}')],
    ['constructor key', JSON.parse('{"constructor":{"prototype":{"measurementId":"G-TEST12345"}}}')],
    ['prototype key', JSON.parse('{"prototype":{"x":1}}')],
    ['throwing getter', Object.defineProperty({}, 'measurementId', { get() { throw new Error('boom') }, enumerable: true })],
    ['revoked proxy', (() => { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy })()],
    ['bigint', BigInt(10)],
    ['cyclic', (() => { const o: Record<string, unknown> = {}; o.self = o; return o })()],
  ]
  const fields = ['measurementId', 'tagId', 'domain', 'server', 'apiKey', 'apiHost', 'sessionRecording']
  const SECRET = 'ZZSECRETZZ'

  const sink = (value: unknown) => {
    const providers = ['ga4', 'gtm', 'plausible', 'posthog']
    const shapes: Array<unknown> = [value, { [providers[0]]: value }]
    for (const provider of providers) {
      shapes.push({ [provider]: value })
      for (const field of fields) shapes.push({ [provider]: { [field]: value } })
    }
    return shapes
  }

  it.each(hostileValues)('integrations: %s never throws, emits no provider, echoes nothing', (_name, value) => {
    for (const shape of sink(value)) {
      resetAnalyticsWarningsForTests()
      vi.mocked(console.warn).mockClear()
      let out: ResolvedAnalytics = {}
      expect(() => { out = resolveAnalyticsConfig(undefined, shape) }).not.toThrow()
      expect(() => JSON.stringify(buildAnalyticsScripts(out))).not.toThrow()
      expect(() => renderToStaticMarkup(createElement(AnalyticsProvider, { config: out }))).not.toThrow()
      expect(() => renderToStaticMarkup(createElement(GtmNoScript, { config: out }))).not.toThrow()
      const logged = vi.mocked(console.warn).mock.calls.flat().join('\n')
      expect(logged).not.toContain('xxxxxxxx')
      expect(logged).not.toContain('</script>')
      expect(logged).not.toContain('\u0000')
      expect(logged).not.toContain('\u2028')
      // Strings and objects carrying a real ID can legitimately emit; every other class cannot.
      if (!['string', 'array of strings', 'null-prototype object', 'proto key', 'constructor key'].includes(_name)) {
        expect(out).toEqual({})
      }
    }
  })

  it.each(hostileValues)('site.ts analytics: %s never throws', (_name, value) => {
    for (const key of ['googleAnalyticsId', 'plausibleDomain', 'plausibleScriptUrl', 'posthogKey', 'posthogHost']) {
      let out: ResolvedAnalytics = {}
      expect(() => { out = resolveAnalyticsConfig({ [key]: value }, undefined) }).not.toThrow()
      expect(() => renderToStaticMarkup(createElement(AnalyticsProvider, { config: out }))).not.toThrow()
    }
    expect(() => resolveAnalyticsConfig(value, value)).not.toThrow()
    expect(() => resolveAnalyticsConfig({ analytics: value }, value)).not.toThrow()
  })

  it('does not emit a provider for hostile docs.json values', () => {
    for (const bad of [null, 7, true, [], {}, big, 'G-TEST\u00001234', '</script>']) {
      expect(resolveAnalyticsConfig(undefined, {
        ga4: { measurementId: bad }, gtm: { tagId: bad }, plausible: { domain: bad }, posthog: { apiKey: bad },
      })).toEqual({})
    }
  })

  it('never echoes a rejected docs.json value, whatever the field', () => {
    for (const provider of ['ga4', 'gtm', 'plausible', 'posthog']) {
      for (const field of fields) {
        resolveAnalyticsConfig(undefined, { [provider]: { [field]: SECRET + '\u0000' + big } })
      }
    }
    expect(vi.mocked(console.warn).mock.calls.flat().join('\n')).not.toContain(SECRET)
  })

  it('falls back to defaults for empty site.ts Plausible script URL and PostHog host', () => {
    const out = resolveAnalyticsConfig({ plausibleDomain: 'docs.example.com', plausibleScriptUrl: '', posthogKey: KEY, posthogHost: '' }, undefined)
    expect(out.plausible?.scriptUrl).toBe('https://plausible.io/js/script.js')
    expect(out.posthog?.apiHost).toBe('https://us.i.posthog.com')
  })

  it('does not throw for BigInt or cyclic values in site.ts', () => {
    const cyc: Record<string, unknown> = {}
    cyc.self = cyc
    const out = resolveAnalyticsConfig({ googleAnalyticsId: BigInt(10), posthogKey: cyc, plausibleDomain: cyc, posthogHost: BigInt(10) }, { ga4: { measurementId: 'G-TEST12345' } })
    expect(out).toEqual({ ga4: { measurementId: 'G-TEST12345' } })
    expect(() => JSON.stringify(buildAnalyticsScripts(out))).not.toThrow()
  })
})
