/** A migrated redirect set must never hide a served page or send a visitor in a circle. */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { migrateRepository } from '../index.js'
import { dropConflictingRedirects, dropUnroutableRedirects } from '../redirects.js'
import type { MigrationBundle, MigrationDocsConfig } from '../types.js'

type Redirects = NonNullable<MigrationDocsConfig['redirects']>

/** First literal redirect cycle, followed the way a browser would, or null. */
function redirectCycle(redirects: Redirects): Array<string> | null {
  const next = new Map<string, string>()
  for (const { source, destination } of redirects) if (!next.has(source)) next.set(source, destination)
  for (const start of next.keys()) {
    const path = [start]
    for (let current = next.get(start); current; current = next.get(current)) {
      if (path.includes(current)) return [...path, current]
      path.push(current)
    }
  }
  return null
}

const messages = (bundle: MigrationBundle): string => bundle.warnings.map((warning) => warning.message).join('\n')

function mintlify(config: Record<string, unknown>, pages: Record<string, string>): MigrationBundle {
  const root = mkdtempSync(join(tmpdir(), 'thally-redirect-conflicts-'))
  writeFileSync(join(root, 'docs.json'), JSON.stringify({ $schema: 'https://mintlify.com/docs.json', ...config }))
  for (const [path, content] of Object.entries(pages)) {
    mkdirSync(dirname(join(root, `${path}.mdx`)), { recursive: true })
    writeFileSync(join(root, `${path}.mdx`), content)
  }
  return migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'mintlify' })
}

describe('Mintlify redirects that would loop or hide a page', () => {
  it('serves the root page at /introduction when the source redirected /introduction back to /', () => {
    const bundle = mintlify({
      redirects: [{ source: '/introduction', destination: '/' }, { source: '/old', destination: '/guide' }],
      navigation: { groups: [{ group: 'Start', pages: ['index', 'guide'] }] },
    }, {
      index: '---\ntitle: Home\n---\n\nWelcome.',
      guide: '---\ntitle: Guide\n---\n\nBody.',
    })
    const redirects = bundle.docsConfig.redirects ?? []
    expect(bundle.pages.map((page) => page.id)).toContain('introduction')
    expect(redirects).toContainEqual({ source: '/', destination: '/introduction', permanent: true })
    expect(redirects).toContainEqual({ source: '/old', destination: '/guide' })
    expect(redirects.some((redirect) => redirect.source === '/introduction')).toBe(false)
    expect(redirectCycle(redirects)).toBeNull()
    expect(messages(bundle)).toContain('/introduction')
  })

  it('drops a redirect from a differently cased address to a page, and says it can come back on a case-sensitive host', () => {
    const bundle = mintlify({
      redirects: [{ source: '/Guide', destination: '/guide' }, { source: '/old', destination: '/guide' }],
      navigation: { groups: [{ group: 'Start', pages: ['index', 'guide'] }] },
    }, {
      index: '---\ntitle: Home\n---\n\nWelcome.',
      guide: '---\ntitle: Guide\n---\n\nBody.',
    })
    const redirects = bundle.docsConfig.redirects ?? []
    expect(redirects.map((redirect) => redirect.source)).not.toContain('/Guide')
    expect(redirects).toContainEqual({ source: '/old', destination: '/guide' })
    expect(messages(bundle)).toContain('Skipped 1 redirect from /Guide: that URL differs only in letter case from a page in this site, so on a server that ignores letter case it would hide that page. If your host matches URLs case-sensitively, add it back to docs.json.')
    expect(messages(bundle)).not.toMatch(/Self-redirect|also a page/)
  })

  it('keeps a redirect that does not touch a page', () => {
    const bundle = mintlify({
      redirects: [{ source: '/old', destination: '/guide' }],
      navigation: { groups: [{ group: 'Start', pages: ['index', 'guide'] }] },
    }, { index: '# Home\n\nWelcome.', guide: '# Guide\n\nBody.' })
    expect(bundle.docsConfig.redirects).toContainEqual({ source: '/old', destination: '/guide' })
    expect(messages(bundle)).not.toMatch(/hide|circle/)
  })

  it('drops the redirect that closes a cycle between two missing URLs and keeps the first', () => {
    const bundle = mintlify({
      redirects: [{ source: '/a', destination: '/b' }, { source: '/b', destination: '/a' }],
      navigation: { groups: [{ group: 'Start', pages: ['index'] }] },
    }, { index: '# Home\n\nWelcome.' })
    const redirects = bundle.docsConfig.redirects ?? []
    expect(redirects).toContainEqual({ source: '/a', destination: '/b' })
    expect(redirects.some((redirect) => redirect.source === '/b')).toBe(false)
    expect(redirectCycle(redirects)).toBeNull()
    expect(messages(bundle)).toContain('/b')
  })
})

describe('Mintlify default version redirects', () => {
  it('leaves the page a version alias would hide alone, and says nothing about the alias', () => {
    const bundle = mintlify({
      navigation: { versions: [
        { version: 'v2', default: true, groups: [{ group: 'Start', pages: ['v2/guide'] }] },
        { version: 'v1', groups: [{ group: 'Start', pages: ['v1/guide'] }] },
      ] },
    }, {
      'v2/guide': '# Guide v2\n\nBody.',
      'v1/guide': '# Guide v1\n\nBody.',
      guide: '# Guide\n\nBody.',
    })
    expect(bundle.pages.map((page) => page.id)).toContain('guide')
    expect((bundle.docsConfig.redirects ?? []).map((redirect) => redirect.source)).not.toContain('/guide')
    expect(messages(bundle)).not.toMatch(/\/guide/)
  })
})

describe('Fern and Docusaurus redirects that hide a page', () => {
  it('drops a Fern redirect whose source is a page of the site', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-redirect-conflicts-fern-'))
    mkdirSync(join(root, 'fern'))
    writeFileSync(join(root, 'fern', 'fern.config.json'), '{}')
    writeFileSync(join(root, 'fern', 'docs.yml'), [
      'title: Docs',
      'navigation:',
      '  - page: Guide',
      '    path: guide.mdx',
      '  - page: Other',
      '    path: other.mdx',
      'redirects:',
      '  - source: /guide',
      '    destination: /other',
      '  - source: /old',
      '    destination: /other',
      '',
    ].join('\n'))
    writeFileSync(join(root, 'fern', 'guide.mdx'), '# Guide\n\nBody.')
    writeFileSync(join(root, 'fern', 'other.mdx'), '# Other\n\nBody.')
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'fern' })
    const sources = (bundle.docsConfig.redirects ?? []).map((redirect) => redirect.source)
    expect(bundle.pages.map((page) => page.id)).toContain('guide')
    expect(sources).toContain('/old')
    expect(sources).not.toContain('/guide')
    expect(messages(bundle)).toContain('/guide')
  })

  it('drops a Docusaurus redirect whose source is a page of the site', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-redirect-conflicts-docusaurus-'))
    writeFileSync(join(root, 'docusaurus.config.js'), [
      'module.exports = { presets: [["classic", { docs: {} }]], plugins: [["@docusaurus/plugin-client-redirects", { redirects: [',
      '  { from: "/guide", to: "/other" },',
      '  { from: "/old", to: "/other" },',
      '] }]] }',
    ].join('\n'))
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\n\nBody.')
    writeFileSync(join(root, 'docs', 'other.md'), '# Other\n\nBody.')
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'docusaurus' })
    const sources = (bundle.docsConfig.redirects ?? []).map((redirect) => redirect.source)
    expect(bundle.pages.map((page) => page.id)).toContain('guide')
    expect(sources).toContain('/old')
    expect(sources).not.toContain('/guide')
    expect(messages(bundle)).toContain('/guide')
  })
})

describe('dropConflictingRedirects', () => {
  const pages = [{ id: 'introduction' }, { id: 'guide' }, { id: 'fr/guide' }, { id: 'section/index' }]
  const config = (redirects: Redirects): MigrationDocsConfig => ({ tabs: [], redirects })

  it('leaves patterns, query destinations and an unrelated redirect alone', () => {
    const redirects: Redirects = [
      { source: '/docs/:slug*', destination: '/guide' },
      { source: '/legacy', destination: '/guide?tab=x' },
      { source: '/', destination: '/introduction', permanent: true },
    ]
    const warnings: Array<{ code: 'unsupported-config'; message: string }> = []
    expect(dropConflictingRedirects(config(redirects), pages, warnings).redirects).toEqual(redirects)
    expect(warnings).toEqual([])
  })

  it('drops a redirect from any served page, including locale pages and a directory index', () => {
    const warnings: Array<{ code: 'unsupported-config'; message: string }> = []
    const result = dropConflictingRedirects(config([
      { source: '/guide/', destination: '/x' },
      { source: '/fr/guide', destination: '/x' },
      { source: '/section', destination: '/x' },
      { source: '/keep', destination: '/x' },
    ]), pages, warnings)
    expect(result.redirects).toEqual([{ source: '/keep', destination: '/x' }])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('/guide/, /fr/guide, /section')
  })

  it('breaks a longer cycle at the redirect that closes it', () => {
    const warnings: Array<{ code: 'unsupported-config'; message: string }> = []
    const result = dropConflictingRedirects(config([
      { source: '/a', destination: '/b' },
      { source: '/b', destination: '/c' },
      { source: '/c', destination: '/a' },
      { source: '/d', destination: '/a' },
    ]), pages, warnings)
    expect(result.redirects).toEqual([
      { source: '/a', destination: '/b' },
      { source: '/b', destination: '/c' },
      { source: '/d', destination: '/a' },
    ])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('/c')
  })

  it('compares routes without regard to letter case, since a server may ignore it', () => {
    const warnings: Array<{ code: 'unsupported-config'; message: string }> = []
    const result = dropConflictingRedirects(config([
      { source: '/Guide', destination: '/guide' },
      { source: '/FR/guide', destination: '/x' },
      { source: '/a', destination: '/B' },
      { source: '/b', destination: '/A' },
      { source: '/Quickstart', destination: '/quickstart' },
      { source: '/guide/', destination: '/x' },
    ]), pages, warnings)
    expect(result.redirects).toEqual([{ source: '/a', destination: '/B' }])
    expect(warnings.map((warning) => warning.message)).toEqual([
      'Skipped 1 redirect from /guide/: that URL is also a page in this site, and a redirect would hide it. To redirect instead, delete the page and add the redirect to docs.json.',
      'Skipped 2 redirects from /Guide, /FR/guide: those URLs differ only in letter case from pages in this site, so on a server that ignores letter case they would hide those pages. If your host matches URLs case-sensitively, add them back to docs.json.',
      'Skipped 2 redirects that would send visitors in a circle on a server that ignores letter case, since the addresses involved differ only in letter case: /b -> /A, /Quickstart -> /quickstart. If your host matches URLs case-sensitively, add them back to docs.json.',
    ])
  })

  it('breaks a cycle whose routes differ in case, keeping the redirect listed first', () => {
    const warnings: Array<{ code: 'unsupported-config'; message: string }> = []
    const result = dropConflictingRedirects(config([
      { source: '/a', destination: '/B' },
      { source: '/b', destination: '/A' },
      { source: '/c', destination: '/d' },
      { source: '/D', destination: '/C' },
    ]), pages, warnings)
    expect(result.redirects).toEqual([{ source: '/a', destination: '/B' }, { source: '/c', destination: '/d' }])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('/b -> /A, /D -> /C')
    expect(warnings[0].message).toContain('letter case')
  })

  it('still breaks a loop between routes of the same case', () => {
    const warnings: Array<{ code: 'unsupported-config'; message: string }> = []
    const result = dropConflictingRedirects(config([
      { source: '/Old', destination: '/New' },
      { source: '/New', destination: '/Old' },
    ]), pages, warnings)
    expect(result.redirects).toEqual([{ source: '/Old', destination: '/New' }])
    expect(warnings.map((warning) => warning.message)).toEqual(['Skipped 1 redirect that would send visitors in a circle: /New -> /Old. Check these redirects in the source docs.'])
  })

  it('words a conflict as a letter-case one only when letter case alone causes it', () => {
    const exact: Array<{ code: 'unsupported-config'; message: string }> = []
    dropConflictingRedirects(config([
      { source: '/guide', destination: '/x' },
      { source: '/Old', destination: '/New' },
      { source: '/New', destination: '/Old' },
    ]), pages, exact)
    expect(exact).toHaveLength(2)
    expect(exact.map((warning) => warning.message).join('\n')).not.toMatch(/letter case|case-sensitive/)

    const onlyCase: Array<{ code: 'unsupported-config'; message: string }> = []
    dropConflictingRedirects(config([
      { source: '/Guide', destination: '/x' },
      { source: '/a', destination: '/B' },
      { source: '/b', destination: '/A' },
    ]), pages, onlyCase)
    expect(onlyCase).toHaveLength(2)
    for (const warning of onlyCase) expect(warning.message).toMatch(/only in letter case/)
    expect(onlyCase.map((warning) => warning.message).join('\n')).not.toMatch(/also a page|Check these redirects/)
  })

  it('walks a long chain of redirects once, however they are ordered', () => {
    const size = 20_000
    // Each redirect points at the source of the one listed before it, so every walk would reach the end of the chain.
    const chain: Redirects = Array.from({ length: size }, (_, index) => ({ source: `/p${size - index}`, destination: `/p${size - index + 1}` }))
    const warnings: Array<{ code: 'unsupported-config'; message: string }> = []
    const result = dropConflictingRedirects(config([...chain, { source: `/p${size + 1}`, destination: '/p1' }]), pages, warnings)
    expect(result.redirects).toEqual(chain)
    expect(warnings).toHaveLength(1)
  })

  it('returns a config without redirects unchanged', () => {
    const bare: MigrationDocsConfig = { tabs: [] }
    expect(dropConflictingRedirects(bare, pages, [])).toBe(bare)
  })
})

describe('dropUnroutableRedirects', () => {
  const config = (redirects: Redirects): MigrationDocsConfig => ({ tabs: [], redirects })

  it('omits self-redirects and sources with route-pattern operators, naming the operator sources in one warning', () => {
    const warnings: Array<{ code: 'unsupported-config'; message: string }> = []
    const result = dropUnroutableRedirects(config([
      { source: '/docs/models/', destination: '/docs/models' },
      { source: '/docs/models', destination: '/docs/models?view=all' },
      { source: '/sdk/c++/users', destination: '/api/users' },
      { source: '/sdk/c++/groups', destination: '/api/groups' },
      { source: '/docs/:slug*', destination: '/guide' },
      { source: '/keep', destination: '/guide' },
    ]), warnings)
    expect(result.redirects).toEqual([
      { source: '/docs/models', destination: '/docs/models?view=all' },
      { source: '/docs/:slug*', destination: '/guide' },
      { source: '/keep', destination: '/guide' },
    ])
    expect(warnings).toHaveLength(2)
    expect(warnings[0].message).toBe('Self-redirect from /docs/models/ to /docs/models was omitted.')
    expect(warnings[1].message).toContain('Skipped 2 redirects from /sdk/c++/users, /sdk/c++/groups')
  })

  it('leaves a redirect between two cases of one address to the conflict check, which says why', () => {
    const warnings: Array<{ code: 'unsupported-config'; message: string }> = []
    const input = config([{ source: '/Guide', destination: '/guide' }])
    expect(dropUnroutableRedirects(input, warnings)).toBe(input)
    expect(warnings).toEqual([])
  })

  it('returns the same config, and says nothing, when every redirect is routable', () => {
    const warnings: Array<{ code: 'unsupported-config'; message: string }> = []
    const input = config([{ source: '/a', destination: '/b' }])
    expect(dropUnroutableRedirects(input, warnings)).toBe(input)
    expect(warnings).toEqual([])
  })
})
