/** A migrated redirect set must never hide a served page or send a visitor in a circle. */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { migrateRepository } from '../index.js'
import { dropConflictingRedirects } from '../redirects.js'
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

  it('returns a config without redirects unchanged', () => {
    const bare: MigrationDocsConfig = { tabs: [] }
    expect(dropConflictingRedirects(bare, pages, [])).toBe(bare)
  })
})
