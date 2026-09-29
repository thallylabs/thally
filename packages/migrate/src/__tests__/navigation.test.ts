/** Mintlify navigation projection invariants shared by every migration entrypoint. */

import { describe, expect, it } from 'vitest'
import {
  addMintlifyDirectoryRedirects,
  parseMarkdownPage,
  projectMintlifyNavigation,
  pruneMissingNavigationPages,
} from '../index.js'
import { mintlifyNavigationApiReferences } from '../navigation.js'
import { projectFernNavigation } from '../fern.js'
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
    expect(result.redirects).toEqual([
      authored,
      { source: '/guides/examples', destination: '/guides/examples/webhook', permanent: false },
    ])
    expect(result.redirects?.some((redirect) => redirect.source === '/guides')).toBe(false)
  })

  it('preserves real directory pages and explicit redirect precedence', () => {
    const incoming = { source: '/examples/:slug*', destination: '/guides/examples/:slug*' }
    const realPage = addMintlifyDirectoryRedirects({ tabs, redirects: [incoming] }, [
      page('guides/examples'), page('guides/examples/webhook'),
    ])
    expect(realPage.redirects).toEqual([incoming])
    for (const source of ['/guides/examples', '/guides/examples/:path*']) {
      const explicit = { source, destination: '/chosen' }
      const result = addMintlifyDirectoryRedirects({ tabs, redirects: [incoming, explicit] }, [page('guides/examples/webhook')])
      expect(result.redirects).toEqual([incoming, explicit])
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
    ])
  })

  it('normalizes query and fragment suffixes without modifying the authored redirect', () => {
    const incoming = { source: '/examples/:slug*', destination: '/guides/examples/:slug*?tab=start#details' }
    const result = addMintlifyDirectoryRedirects({ tabs, redirects: [incoming] }, [page('guides/examples/webhook')])
    expect(result.redirects).toEqual([
      incoming,
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
    expect(result.redirects?.slice(3)).toEqual([
      { source: '/guides/examples', destination: '/guides/examples/webhook', permanent: false },
      { source: '/fr/guides/examples', destination: '/fr/guides/examples/database', permanent: false },
    ])
  })

  it('does not synthesize arbitrary directories or unresolved navigation entries', () => {
    const result = addMintlifyDirectoryRedirects({ tabs, redirects: [
      { source: '/old', destination: '/unlisted' },
      { source: '/required/:slug', destination: '/guides/examples/:slug' },
    ] }, [page('unlisted/child'), page('guides/examples/database')])
    expect(result.redirects).toHaveLength(2)
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

describe('Fern external navigation links', () => {
  it('preserves safe nested links in the navbar alongside authored navbar links', () => {
    const result = projectFernNavigation({
      config: {
        'navbar-links': [{ type: 'github', value: 'https://github.com/NVIDIA/SkillEvaluator' }],
        navigation: [
          { page: 'Overview', path: '../docs/index.mdx' },
          { section: 'Reference', contents: [
            { page: 'CLI', path: '../docs/cli.mdx' },
            { link: 'NVIDIA Verified Skills', href: 'https://docs.nvidia.com/skills/' },
          ] },
        ],
      },
      fernRoot: '/tmp/fern-root-unused',
      repositoryRoot: '/tmp',
    })
    expect(result.docsConfig.navbar?.links).toEqual([
      { label: 'GitHub', href: 'https://github.com/NVIDIA/SkillEvaluator', type: 'github' },
      { label: 'NVIDIA Verified Skills', href: 'https://docs.nvidia.com/skills/' },
    ])
    expect(result.warnings.some((warning) => warning.message.includes('Fern navigation "link"'))).toBe(false)
  })

  it('drops unsafe external targets and hidden links', () => {
    const result = projectFernNavigation({
      config: { navigation: [
        { link: 'Unsafe', href: 'javascript:alert(1)' },
        { link: 'Credentials', href: 'https://user:pass@example.com/' },
        { link: 'Hidden', href: 'https://example.com/', hidden: true },
      ] },
      fernRoot: '/tmp/fern-root-unused',
    })
    expect(result.docsConfig.navbar).toBeUndefined()
    expect(result.warnings.filter((warning) => warning.message.includes('unsafe or invalid external URL'))).toHaveLength(2)
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

describe('Mintlify tab menus', () => {
  const menuTab = {
    tab: 'Developer Tools',
    icon: 'square-terminal',
    menu: [
      { item: 'API reference', icon: 'rocket', groups: [{ group: 'Core endpoints', pages: ['api-reference/get', 'api-reference/post'] }] },
      { item: 'SDKs', icon: 'code', description: 'SDKs are used to interact with the API.', pages: ['sdk/fetch', 'sdk/create'] },
    ],
  }

  it('projects a tab menu as one tab with a group per item and keeps every page', () => {
    const result = projectMintlifyNavigation({ navigation: { tabs: [menuTab] } })

    expect(result.docsConfig.tabs).toEqual([{
      tab: 'Developer Tools',
      icon: 'square-terminal',
      groups: [
        { group: 'API reference', icon: 'rocket', pages: [{ group: 'Core endpoints', pages: ['api-reference/get', 'api-reference/post'] }] },
        { group: 'SDKs', icon: 'code', pages: ['sdk/fetch', 'sdk/create'] },
      ],
    }])
    expect(result.pageReferences.map((reference) => reference.navigationId)).toEqual([
      'api-reference/get', 'api-reference/post', 'sdk/fetch', 'sdk/create',
    ])
  })

  it('warns about a menu item description instead of dropping it silently', () => {
    const result = projectMintlifyNavigation({ navigation: { tabs: [menuTab] } })
    expect(result.warnings.map((warning) => warning.message).join('\n')).toContain('"SDKs" has a description')
  })

  it('warns about an href-only menu item and an empty item', () => {
    const result = projectMintlifyNavigation({ navigation: { tabs: [{
      tab: 'Tools',
      menu: [{ item: 'Blog', href: 'https://example.com/blog' }, { item: 'Docs', pages: ['a'] }],
    }] } })
    expect(result.docsConfig.tabs[0]?.groups).toEqual([{ group: 'Docs', pages: ['a'] }])
    const messages = result.warnings.map((warning) => warning.message).join('\n')
    expect(messages).toContain('"Blog" links to https://example.com/blog')
  })

  it('keeps sibling tabs without a menu and nests a menu under a dropdown or version', () => {
    const mixed = projectMintlifyNavigation({ navigation: { tabs: [
      { tab: 'Guides', pages: ['guides/start'] },
      menuTab,
    ] } })
    expect(mixed.docsConfig.tabs.map((tab) => tab.tab)).toEqual(['Guides', 'Developer Tools'])

    const nested = projectMintlifyNavigation({ navigation: { versions: [
      { version: 'v2', tabs: [menuTab] },
    ] } })
    expect(nested.docsConfig.tabs[0]?.tab).toBe('v2')
    expect(nested.pageReferences).toHaveLength(4)
  })

  it('binds a menu item openapi to the enclosing tab', () => {
    const references = mintlifyNavigationApiReferences({ navigation: { tabs: [{
      tab: 'Developer Tools',
      menu: [{ item: 'API reference', openapi: 'openapi.yaml' }],
    }] } })
    expect(references).toEqual([{ value: 'openapi.yaml', kind: 'openapi', tabLabel: 'Developer Tools' }])
  })

  it('still honors the legacy plural menus container', () => {
    const result = projectMintlifyNavigation({ navigation: { menus: [{ menu: 'One', pages: ['one'] }] } })
    expect(result.docsConfig.tabs).toEqual([{ tab: 'One', pages: ['one'] }])
  })

  it('warns about an unrecognized container instead of dropping it silently', () => {
    const result = projectMintlifyNavigation({ navigation: {
      tabs: [{ tab: 'A', pages: ['a'] }],
      sections: [{ name: 'X', pages: ['x'] }],
    } })
    expect(result.warnings.map((warning) => warning.message).join('\n')).toContain('"sections"')
  })

  it('leaves existing tab, anchor and dropdown output unchanged', () => {
    const tabs = projectMintlifyNavigation({ navigation: { tabs: [{ tab: 'T', groups: [{ group: 'G', pages: ['g/a'] }] }] } })
    expect(tabs.docsConfig.tabs).toEqual([{ tab: 'T', groups: [{ group: 'G', pages: ['g/a'] }] }])
    const anchors = projectMintlifyNavigation({ navigation: { anchors: [{ anchor: 'A', pages: ['a'] }] } })
    expect(anchors.docsConfig.tabs).toEqual([{ tab: 'A', pages: ['a'] }])
    const dropdowns = projectMintlifyNavigation({ navigation: { dropdowns: [{ dropdown: 'D', pages: ['d'] }] } })
    expect(dropdowns.docsConfig.tabs).toEqual([{ tab: 'D', pages: ['d'] }])
    expect(dropdowns.docsConfig.navigation).toEqual({ display: 'dropdown' })
    expect(tabs.warnings).toEqual([])
  })
})
