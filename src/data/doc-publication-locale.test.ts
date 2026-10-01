/**
 * The build records pages by their file (`fr/foo` for a translation), but a
 * localized route renders its own translation when there is one and the
 * primary page otherwise. Every localized listing must judge the file the
 * route would render.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { collectRuntimeContentFiles } from '../../scripts/lib/runtime-content-files'

const ok = { responses: { 200: { description: 'ok' } } }
const HIDDEN = 'openapi: "GET /hidden"'
const SHOWN = 'openapi: "GET /shown"'
// [primary frontmatter, French frontmatter or null for no translation]
const PAGES: Record<string, [string, string | null]> = {
  plain: ['', ''],
  both: [HIDDEN, HIDDEN],
  'fr-only': [SHOWN, HIDDEN],
  'primary-only': [HIDDEN, ''],
  'no-fr': [HIDDEN, null],
  'shown-everywhere': [SHOWN, SHOWN],
}
const ids = Object.keys(PAGES)

const state = vi.hoisted(() => ({ sources: {} as Record<string, { content: string }> }))
const config = vi.hoisted(() => ({
  tabs: [{ tab: 'Docs', groups: [{ group: 'Guides', pages: [] as Array<string> }] }],
  i18n: {
    defaultLocale: 'en',
    locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Francais' }],
    navigation: { fr: [{ tab: 'Docs', groups: [{ group: 'Guides', pages: [] as Array<string> }] }] },
  } as Record<string, unknown>,
}))

vi.mock('@/lib/docs-json-config', () => ({ getDocsJsonConfig: () => config, getDocsJsonConfigRevision: () => 1 }))
vi.mock('@/lib/runtime-sources', () => ({
  listRuntimeSources: () => Object.keys(state.sources),
  readRuntimeSource: (file: string) => state.sources[file].content,
  runtimeSourceExists: (file: string) => file in state.sources,
}))
vi.mock('@/lib/content-index', () => ({ getContentIndex: () => null, loadContentIndex: async () => null }))
vi.mock('@/lib/content-source', () => ({
  getContentSource: () => ({
    kind: 'filesystem',
    exists: async (file: string) => file in state.sources,
    read: async (file: string) => (file in state.sources ? { content: state.sources[file].content } : null),
  }),
}))
vi.mock('@/config/api-reference', () => ({ apiReferenceConfig: { defaultSpecId: 'default', specs: [] } }))

const mdx = (id: string, frontmatter: string) => `---\ntitle: ${id}\n${frontmatter}\n---\nBody`

beforeEach(() => {
  config.tabs[0].groups[0].pages = [...ids]
  ;(config.i18n.navigation as { fr: typeof config.tabs }).fr[0].groups[0].pages = [...ids]
  const root = mkdtempSync(path.join(tmpdir(), 'thally-publication-locale-'))
  mkdirSync(path.join(root, 'openapi'))
  writeFileSync(path.join(root, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'API', api: { source: 'openapi/x.json' } }] }))
  writeFileSync(path.join(root, 'openapi/x.json'), JSON.stringify({
    openapi: '3.1.0', info: { title: 'T', version: '1' },
    paths: { '/hidden': { get: { 'x-hidden': true, ...ok } }, '/shown': { get: ok } },
  }))
  mkdirSync(path.join(root, 'src/content/fr'), { recursive: true })
  for (const [id, [primary, french]] of Object.entries(PAGES)) {
    writeFileSync(path.join(root, `src/content/${id}.mdx`), mdx(id, primary))
    if (french !== null) writeFileSync(path.join(root, `src/content/fr/${id}.mdx`), mdx(id, french))
  }
  state.sources = { ...collectRuntimeContentFiles(root) }
})

const cold = async () => {
  vi.resetModules()
  return import('@/data/docs')
}
const sidebarIds = (docs: Awaited<ReturnType<typeof cold>>, locale?: string) =>
  docs.getSidebarCollections(locale)[0].sections.flatMap((section) => section.items.map((item) => item.href.replace(/^\/fr\//, '/').slice(1)))

describe('the build record and the files it names', () => {
  it('records a translation under its own file id', () => {
    const recorded = JSON.parse(state.sources['thally-unpublished-pages.json'].content) as Array<string>
    expect([...recorded].sort()).toEqual(['both', 'fr/both', 'fr/fr-only', 'no-fr', 'primary-only'])
  })
})

describe('isDocPublished with a locale', () => {
  it('judges the translation when there is one, the primary page when there is not', async () => {
    const docs = await cold()
    const published = (locale?: string) => ids.filter((id) => docs.isDocPublished(id, locale))
    expect(published()).toEqual(['plain', 'fr-only', 'shown-everywhere'])
    expect(published('en')).toEqual(['plain', 'fr-only', 'shown-everywhere'])
    expect(published('fr')).toEqual(['plain', 'primary-only', 'shown-everywhere'])
  })
})

describe('localized listings', () => {
  it('the localized sidebar lists what the fr route renders', async () => {
    const docs = await cold()
    expect(sidebarIds(docs)).toEqual(['plain', 'fr-only', 'shown-everywhere'])
    expect(sidebarIds(docs, 'fr')).toEqual(['plain', 'primary-only', 'shown-everywhere'])
  })

  it('sitemap, docs-index and search treat an unpublished translation as absent', async () => {
    await cold()
    const { getIndexableDocTranslation, hasDocTranslation } = await import('@/lib/i18n/translation-source')
    const indexable = async (id: string) => Boolean(await getIndexableDocTranslation([id], 'fr'))
    expect(await Promise.all(ids.map(indexable))).toEqual([true, false, false, true, false, true])
    expect(await Promise.all(ids.map((id) => hasDocTranslation([id], 'fr')))).toEqual([true, false, false, true, false, true])
  })
})
