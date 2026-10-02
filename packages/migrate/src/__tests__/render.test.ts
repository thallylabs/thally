/** Merge invariants for importing into an existing localized Thally site. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { mergeMigrationConfig } from '../index.js'
import { migrateRepository } from '../repository.js'
import { renderMigrationFiles } from '../render.js'

const roots: Array<string> = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** Migrate a one-off Mintlify source and return the rendered page file for `id`. */
function renderedPage(files: Record<string, string>, id: string): string {
  const root = mkdtempSync(join(tmpdir(), 'thally-render-'))
  roots.push(root)
  const all = { 'docs.json': JSON.stringify({ name: 'Acme', navigation: { pages: ['intro'] } }), ...files }
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs' })
  return String(renderMigrationFiles(bundle).find((file) => file.path === `src/content/${id}.mdx`)!.content)
}

describe('page icon frontmatter', () => {
  it('carries icon and a supported iconType into the migrated page', () => {
    const out = renderedPage({ 'intro.mdx': '---\ntitle: Intro\nicon: book-open\niconType: solid\n---\nHello\n' }, 'intro')
    expect(out).toContain('icon: "book-open"')
    expect(out).toContain('iconType: "solid"')
  })
})

describe('migration config merge', () => {
  it('unions existing and imported locales without duplicating page ids', () => {
    const merged = mergeMigrationConfig(
      {
        tabs: [{ tab: 'Existing', groups: [{ group: 'Start', pages: ['introduction'] }] }],
        navigation: { display: 'tabs' },
        i18n: {
          defaultLocale: 'en',
          locales: [{ code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' }],
        },
      },
      {
        tabs: [{ tab: 'Documentation', groups: [{ group: 'Start', pages: ['introduction', 'guides/install'] }] }],
        navigation: { display: 'dropdown' },
        i18n: {
          defaultLocale: 'en',
          locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'French' }],
        },
      },
    )

    expect(merged.i18n?.locales.map((locale) => locale.code)).toEqual(['en', 'es', 'fr'])
    expect(merged.navigation).toEqual({ display: 'dropdown' })
    expect(merged.tabs).toEqual([
      { tab: 'Existing', groups: [{ group: 'Start', pages: ['introduction'] }] },
      { tab: 'Documentation', groups: [{ group: 'Start', pages: ['guides/install'] }] },
    ])
  })

  it('deduplicates and merges root navigation nodes without adding a wrapper group', () => {
    const merged = mergeMigrationConfig(
      {
        tabs: [{ tab: 'Documentation', pages: ['introduction'] }],
      },
      {
        tabs: [{
          tab: 'Documentation',
          pages: [
            'introduction',
            { group: 'Guides', pages: ['guides/install'] },
          ],
          groups: [{ group: 'Reference', pages: ['reference/api'] }],
        }],
      },
    )

    expect(merged.tabs).toEqual([{
      tab: 'Documentation',
      pages: [
        'introduction',
        { group: 'Guides', pages: ['guides/install'] },
        { group: 'Reference', pages: ['reference/api'] },
      ],
    }])
  })
})
