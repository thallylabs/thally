/** Mintlify navigation projection invariants shared by every migration entrypoint. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addMintlifyDirectoryRedirects,
  parseMarkdownPage,
  projectMintlifyNavigation,
  pruneMissingNavigationPages,
} from '../index.js'
import { projectFernNavigation } from '../fern.js'
import { mintlifyNavigationApiReferences, readMintlifyConfig } from '../navigation.js'
import type { MigrationDocsConfig, MigrationPage } from '../types.js'

function page(id: string, navigationId = id, locale?: string): MigrationPage {
  return parseMarkdownPage({ id, navigationId, locale, raw: '# Example', source: 'https://example.com/docs' })!
}

describe('Mintlify referenced directory landings', () => {
  const tabs: MigrationDocsConfig['tabs'] = [{
    tab: 'Guides',
    groups: [{
      group: 'Examples',
      pages: [
        { group: 'Hidden', hidden: true, pages: ['guides/examples/hidden'] },
        { group: 'Nested', pages: ['guides/examples/webhook', 'guides/examples/database'] },
      ],
    }],
  }]

  it('resolves an empty wildcard destination to the first visible nested navigation page', () => {
    const authored = { source: '/examples/:slug*', destination: '/guides/examples/:slug*' }
    const result = addMintlifyDirectoryRedirects({ tabs, redirects: [authored] }, [
      page('guides/examples/database'), page('guides/examples/hidden'), page('guides/examples/webhook'),
    ])
    // '/guides' has no page of its own either, so it also redirects to the
    // same first-descendant landing page as '/guides/examples'.
    expect(result.redirects).toEqual([
      authored,
      { source: '/guides', destination: '/guides/examples/webhook', permanent: false },
      { source: '/guides/examples', destination: '/guides/examples/webhook', permanent: false },
    ])
  })

  it('preserves real directory pages and explicit redirect precedence', () => {
    const incoming = { source: '/examples/:slug*', destination: '/guides/examples/:slug*' }
    const realPage = addMintlifyDirectoryRedirects({ tabs, redirects: [incoming] }, [
      page('guides/examples'), page('guides/examples/webhook'),
    ])
    // '/guides/examples' is a real page and is never overridden, but its
    // ancestor '/guides' still has no page of its own and gets the general
    // first-descendant redirect.
    expect(realPage.redirects).toEqual([
      incoming,
      { source: '/guides', destination: '/guides/examples/webhook', permanent: false },
    ])
    for (const source of ['/guides/examples', '/guides/examples/:path*']) {
      const explicit = { source, destination: '/chosen' }
      const result = addMintlifyDirectoryRedirects({ tabs, redirects: [incoming, explicit] }, [page('guides/examples/webhook')])
      expect(result.redirects).toEqual([
        incoming,
        explicit,
        { source: '/guides', destination: '/guides/examples/webhook', permanent: false },
      ])
    }
  })

  it('retains a conventional overview landing ahead of a first-descendant fallback', () => {
    const incoming = { source: '/examples', destination: '/guides/examples' }
    const result = addMintlifyDirectoryRedirects({ tabs, redirects: [incoming] }, [
      page('guides/examples/webhook'), page('guides/examples/overview'),
    ])
    expect(result.redirects).toEqual([
      incoming,
      { source: '/guides/examples', destination: '/guides/examples/overview', permanent: false },
      { source: '/guides', destination: '/guides/examples/webhook', permanent: false },
    ])
  })

  it('normalizes query and fragment suffixes without modifying the authored redirect', () => {
    const incoming = { source: '/examples/:slug*', destination: '/guides/examples/:slug*?tab=start#details' }
    const result = addMintlifyDirectoryRedirects({ tabs, redirects: [incoming] }, [page('guides/examples/webhook')])
    expect(result.redirects).toEqual([
      incoming,
      { source: '/guides', destination: '/guides/examples/webhook', permanent: false },
      { source: '/guides/examples', destination: '/guides/examples/webhook', permanent: false },
    ])
    expect(addMintlifyDirectoryRedirects(result, [page('guides/examples/webhook')])).toEqual(result)
  })

  it('resolves localized destination directories only to existing matching locale pages', () => {
    const config: MigrationDocsConfig = {
      tabs,
      i18n: { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'French' }] },
      redirects: [
        { source: '/examples/:slug*', destination: '/guides/examples/:slug*' },
        { source: '/fr/examples/:slug*', destination: '/fr/guides/examples/:slug*' },
        { source: '/es/examples/:slug*', destination: '/es/guides/examples/:slug*' },
      ],
    }
    const result = addMintlifyDirectoryRedirects(config, [
      page('guides/examples/webhook', 'guides/examples/webhook', 'en'),
      page('fr/guides/examples/database', 'guides/examples/database', 'fr'),
    ])
    // Every French ancestor directory ('/fr', '/fr/guides', ...) resolves to
    // the French descendant, never to the English one.
    expect(result.redirects?.slice(3)).toEqual([
      { source: '/guides', destination: '/guides/examples/webhook', permanent: false },
      { source: '/guides/examples', destination: '/guides/examples/webhook', permanent: false },
      { source: '/fr', destination: '/fr/guides/examples/database', permanent: false },
      { source: '/fr/guides', destination: '/fr/guides/examples/database', permanent: false },
      { source: '/fr/guides/examples', destination: '/fr/guides/examples/database', permanent: false },
    ])
  })

  it('does not synthesize directories for pages outside the navigation', () => {
    const result = addMintlifyDirectoryRedirects({ tabs, redirects: [
      { source: '/old', destination: '/unlisted' },
      { source: '/required/:slug', destination: '/guides/examples/:slug' },
    ] }, [page('unlisted/child'), page('guides/examples/database')])
    // 'unlisted/child' is never referenced by the `tabs` fixture's
    // navigation, so no directory redirect is synthesized for it — only the
    // navigation-referenced 'guides/examples/database' page's ancestors do.
    expect(result.redirects).toEqual([
      { source: '/old', destination: '/unlisted' },
      { source: '/required/:slug', destination: '/guides/examples/:slug' },
      { source: '/guides', destination: '/guides/examples/database', permanent: false },
      { source: '/guides/examples', destination: '/guides/examples/database', permanent: false },
    ])
    expect(result.redirects?.some((redirect) => redirect.source === '/unlisted')).toBe(false)
  })

  it('redirects a nav-group directory with no page of its own even with no authored redirect pointing at it', () => {
    // Mirrors the live-site behavior this fix targets: a Mintlify container
    // path (e.g. a `product`/`tab`/`group`, such as Upstash's `/redis`) 307s
    // to its first descendant page purely from navigation structure — no
    // `redirects:` entry involved at all, which the previous implementation
    // required to ever produce this redirect.
    const result = addMintlifyDirectoryRedirects({ tabs }, [
      page('guides/examples/webhook'), page('guides/examples/database'),
    ])
    expect(result.redirects).toEqual([
      { source: '/guides', destination: '/guides/examples/webhook', permanent: false },
      { source: '/guides/examples', destination: '/guides/examples/webhook', permanent: false },
    ])
  })
})

describe('Mintlify navigation projection', () => {
  it('preserves interleaved root pages and nested groups in authored order', () => {
    const result = projectMintlifyNavigation({
      navigation: {
        pages: [
          'introduction',
          { group: 'Guides', pages: ['guides/start'] },
          'faq',
        ],
      },
    })

    expect(result.docsConfig.tabs[0]?.pages).toEqual([
      'introduction',
      { group: 'Guides', pages: ['guides/start'] },
      'faq',
    ])
  })

  it('derives dropdown presentation only from the selected default container', () => {
    const result = projectMintlifyNavigation({
      navigation: {
        languages: [
          {
            locale: 'pt',
            default: true,
            tabs: [{ tab: 'Docs', groups: [{ group: 'Start', pages: ['introduction'] }] }],
          },
          {
            locale: 'fr',
            dropdowns: [{ dropdown: 'Documentation', groups: [{ group: 'Start', pages: ['introduction'] }] }],
          },
        ],
      },
    })

    expect(result.docsConfig.i18n?.defaultLocale).toBe('pt')
    expect(result.docsConfig.navigation).toBeUndefined()
    expect(result.docsConfig.tabs.map((tab) => tab.tab)).toEqual(['Docs'])
    expect(result.docsConfig.i18n?.navigation?.fr?.[0]).toMatchObject({
      tab: 'Documentation',
      groups: [{ group: 'Start', pages: ['introduction'] }],
    })
  })

  it('does not let an empty legacy dropdown array override active tabs', () => {
    const result = projectMintlifyNavigation({
      navigation: {
        tabs: [{ tab: 'Docs', groups: [{ group: 'Start', pages: ['introduction'] }] }],
        dropdowns: [],
      },
    })

    expect(result.docsConfig.navigation).toBeUndefined()
    expect(result.docsConfig.tabs.map((tab) => tab.tab)).toEqual(['Docs'])
  })

  it('honors default versions and inherits their presentation metadata', () => {
    const result = projectMintlifyNavigation({
      navigation: {
        versions: [
          {
            version: 'v1',
            href: '/v1',
            tabs: [
              { tab: 'Guides', groups: [{ group: 'Start', pages: ['v1/introduction'] }] },
              { tab: 'API', groups: [{ group: 'Reference', pages: ['v1/api'] }] },
            ],
          },
          {
            version: 'v2',
            default: true,
            description: 'Current documentation',
            icon: 'book-open',
            href: '/v2',
            tabs: [
              { tab: 'Guides', groups: [{ group: 'Start', pages: ['v2/introduction'] }] },
              { tab: 'API', groups: [{ group: 'Reference', pages: ['v2/api'] }] },
            ],
          },
        ],
      },
    })

    expect(result.docsConfig.tabs.map((tab) => tab.tab)).toEqual([
      'v2: Guides',
      'v2: API',
      'v1: Guides',
      'v1: API',
    ])
    expect(result.docsConfig.tabs[0]).toMatchObject({
      description: 'Current documentation',
      icon: 'book-open',
      href: '/v2',
    })
    expect(result.docsConfig.tabs[1]).toMatchObject({
      description: 'Current documentation',
      icon: 'book-open',
    })
    expect(result.docsConfig.tabs[1]?.href).toBeUndefined()
    expect(result.docsConfig.tabs[2]?.href).toBe('/v1')
    expect(result.docsConfig.tabs[3]?.href).toBeUndefined()
  })

  it('translates a trailing Mintlify wildcard redirect into a Next.js named catch-all', () => {
    const result = projectMintlifyNavigation({
      navigation: { pages: ['introduction'] },
      redirects: [
        { source: '/api-reference/*', destination: '/api/*' },
        { source: '/settings/auth/*', destination: '/deploy/auth-setup' },
        { source: '/api-playground/mdx/:slug*', destination: '/api-playground/mdx-setup' },
      ],
    })

    expect(result.docsConfig.redirects).toEqual([
      { source: '/api-reference/:path*', destination: '/api/:path*' },
      { source: '/settings/auth/:path*', destination: '/deploy/auth-setup' },
      { source: '/api-playground/mdx/:slug*', destination: '/api-playground/mdx-setup' },
    ])
  })

  it('drops a redirect whose wildcard Next.js cannot express and warns instead of crashing', () => {
    const result = projectMintlifyNavigation({
      navigation: { pages: ['introduction'] },
      redirects: [
        { source: '/foo/*/bar', destination: '/baz' },
        { source: '/only-dest-wildcard', destination: '/dest/*' },
        { source: '/kept', destination: '/still-kept' },
      ],
    })

    expect(result.docsConfig.redirects).toEqual([{ source: '/kept', destination: '/still-kept' }])
    expect(result.warnings.filter((warning) => warning.code === 'unsupported-config'
      && warning.message.includes('wildcard'))).toHaveLength(2)
  })

  it('drops a backslash-prefixed or percent-encoded browser-cross-origin redirect destination', () => {
    const result = projectMintlifyNavigation({
      navigation: { pages: ['introduction'] },
      redirects: [
        { source: '/legit', destination: '/\\evil.example' },
        { source: '/legit-2', destination: '/%5Cevil.example' },
        { source: '/kept', destination: '/still-kept' },
      ],
    })

    expect(result.docsConfig.redirects).toEqual([{ source: '/kept', destination: '/still-kept' }])
  })

  it('drops a redirect whose destination hides a browser-cross-origin `//` behind a stripped whitespace/control character', () => {
    const result = projectMintlifyNavigation({
      navigation: { pages: ['introduction'] },
      redirects: [
        { source: '/legit-tab', destination: '/\t/evil.example' },
        { source: '/legit-newline', destination: '/\n/evil.example' },
        { source: '/legit-cr', destination: '/\r/evil.example' },
        { source: '/legit-nul', destination: '/\x00/evil.example' },
        { source: '/kept', destination: '/still-kept' },
      ],
    })

    expect(result.docsConfig.redirects).toEqual([{ source: '/kept', destination: '/still-kept' }])
  })
})

describe('Fern redirect safety shares the Mintlify guard', () => {
  it('drops a backslash-prefixed or percent-encoded browser-cross-origin redirect destination', () => {
    const result = projectFernNavigation({
      config: {
        navigation: [{ page: 'Introduction', path: 'introduction.mdx' }],
        redirects: [
          { source: '/legit', destination: '/\\evil.example' },
          { source: '/legit-2', destination: '/%5Cevil.example' },
          { source: '/kept', destination: '/still-kept' },
        ],
      },
      fernRoot: '/tmp/fern-root-unused',
    })

    expect(result.docsConfig.redirects).toEqual([{ source: '/kept', destination: '/still-kept' }])
  })
})

describe('pruning navigation pages excluded after projection', () => {
  it('keeps a route once per sibling group after two files resolve to the same slug', () => {
    const config: MigrationDocsConfig = { tabs: [{ tab: 'Release Notes', groups: [
      { group: 'Latest', pages: ['changelog', 'changelog/release', 'changelog/release'] },
      { group: 'Archive', pages: ['changelog/release'] },
    ] }] }
    expect(pruneMissingNavigationPages(config, new Set(['changelog', 'changelog/release'])).tabs[0].groups).toEqual([
      { group: 'Latest', pages: ['changelog', 'changelog/release'] },
      { group: 'Archive', pages: ['changelog/release'] },
    ])
  })
  it('drops a page id that was excluded from import, and the group left empty by it', () => {
    const config: MigrationDocsConfig = {
      tabs: [{
        tab: 'Documentation',
        groups: [
          { group: 'Guides', pages: ['guides/intro', 'guides/excluded'] },
          { group: 'Assistant', pages: ['assistant/widget'] },
        ],
      }],
    }

    const pruned = pruneMissingNavigationPages(config, new Set(['guides/intro']))

    expect(pruned).toEqual({
      tabs: [{
        tab: 'Documentation',
        groups: [{ group: 'Guides', pages: ['guides/intro'] }],
      }],
    })
  })

  it('leaves an href-only or api-only tab untouched even though it has no pages', () => {
    const config: MigrationDocsConfig = {
      tabs: [
        { tab: 'Home', href: '/' },
        { tab: 'API Reference', api: { source: '/openapi.json' } },
      ],
    }

    const pruned = pruneMissingNavigationPages(config, new Set())

    expect(pruned.tabs).toEqual(config.tabs)
  })

  it('prunes nested groups and top-level tab pages, across every tab', () => {
    const config: MigrationDocsConfig = {
      tabs: [
        {
          tab: 'Docs',
          pages: ['kept', 'excluded', { group: 'Nested', pages: ['excluded/child', { group: 'Empty', pages: ['also-excluded'] }] }],
        },
        { tab: 'Empty tab', pages: ['excluded'] },
      ],
    }

    const pruned = pruneMissingNavigationPages(config, new Set(['kept']))

    expect(pruned.tabs).toEqual([{ tab: 'Docs', pages: ['kept'] }])
  })
})

describe('Mintlify productGroups wrapper (Upstash-shaped docs.json)', () => {
  const config = {
    navigation: {
      tabs: [{
        tab: 'Documentation',
        productGroups: [{
          group: 'Products',
          products: [{
            product: 'Redis',
            groups: [{ group: 'Overview', pages: ['redis/overview'] }],
          }],
        }],
      }],
    },
  }

  it('projects pages nested under tab.productGroups[].products, not just tab.products', () => {
    const result = projectMintlifyNavigation(config)
    expect(result.docsConfig.tabs).toEqual([{
      tab: 'Documentation',
      groups: [{ group: 'Overview', pages: ['redis/overview'] }],
    }])
  })

  it('still resolves an openapi/asyncapi reference nested under productGroups', () => {
    const nested = {
      navigation: {
        tabs: [{
          tab: 'Documentation',
          productGroups: [{
            group: 'Products',
            products: [{
              product: 'QStash',
              groups: [{ group: 'REST', pages: [{ group: 'API', openapi: 'qstash/openapi.yaml' }] }],
            }],
          }],
        }],
      },
    }
    const references = mintlifyNavigationApiReferences(nested)
    expect(references).toEqual([{ value: 'qstash/openapi.yaml', kind: 'openapi', tabLabel: 'QStash' }])
  })
})

describe('Mintlify openapi object-form reference', () => {
  it('recognizes { source, directory } in addition to a bare string, and reports the directory', () => {
    const config = {
      navigation: {
        tabs: [{
          tab: 'Documentation',
          groups: [{
            group: 'API',
            openapi: { source: 'qstash/openapi.yaml', directory: 'qstash/api-reference' },
          }],
        }],
      },
    }
    const references = mintlifyNavigationApiReferences(config)
    expect(references).toEqual([{
      value: 'qstash/openapi.yaml',
      kind: 'openapi',
      tabLabel: 'Documentation',
      directory: 'qstash/api-reference',
    }])
  })
})

describe('Mintlify manual OpenAPI operation listing', () => {
  it('drops "METHOD /path" navigation entries with one warning instead of a missing-page warning each', () => {
    const config = {
      navigation: {
        tabs: [{
          tab: 'API Reference',
          openapi: 'devops/openapi.yaml',
          groups: [{
            group: 'Redis',
            pages: ['GET /redis/databases', 'POST /redis/database', 'devops/introduction'],
          }],
        }],
      },
    }
    const result = projectMintlifyNavigation(config)
    expect(result.docsConfig.tabs).toEqual([{
      tab: 'API Reference',
      groups: [{ group: 'Redis', pages: ['devops/introduction'] }],
    }])
    const operationWarnings = result.warnings.filter((warning) => /hand-pick or reorder individual OpenAPI operations/.test(warning.message))
    expect(operationWarnings).toHaveLength(1)
    // Not registered as page references at all, so repository.ts's later
    // "did not resolve to a source page" pass never sees them, let alone
    // once per operation.
    expect(result.pageReferences.some((reference) => reference.ref.startsWith('GET ') || reference.ref.startsWith('POST '))).toBe(false)
  })
})

describe('Mintlify config size limit', () => {
  it('reads a docs.json larger than the old 2 MB page limit, up to the 20 MB config limit', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-migrate-mintlify-config-'))
    try {
      // A large but realistic docs.json: many groups/pages, past 2 MB (the
      // page-content limit) but well under the 20 MB config limit.
      const groups = Array.from({ length: 40_000 }, (_, index) => ({
        group: `Group ${index}`,
        pages: [`guides/page-${index}`],
      }))
      writeFileSync(join(root, 'docs.json'), JSON.stringify({ navigation: { tabs: [{ tab: 'Guides', groups }] } }))
      const size = Buffer.byteLength(JSON.stringify({ navigation: { tabs: [{ tab: 'Guides', groups }] } }))
      expect(size).toBeGreaterThan(2_000_000)
      expect(size).toBeLessThan(20_000_000)
      const config = readMintlifyConfig(root)
      expect(config).not.toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('still rejects a docs.json past the 20 MB config limit', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-migrate-mintlify-config-'))
    try {
      const groups = Array.from({ length: 400_000 }, (_, index) => ({
        group: `Group ${index}`,
        pages: [`guides/page-${index}`],
      }))
      writeFileSync(join(root, 'docs.json'), JSON.stringify({ navigation: { tabs: [{ tab: 'Guides', groups }] } }))
      expect(() => readMintlifyConfig(root)).toThrow(/exceeded 20 MB/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
