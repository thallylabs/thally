/** Locale indexing and freshness must follow actual source and translation bytes. */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ files: new Map<string, { content: string; modifiedAtMs: number }>() }))

vi.mock('@/data/docs', () => ({
  deriveTitleFromSlug: (slug: string) => slug,
  getI18nConfig: () => ({ defaultLocale: 'en' }),
  ensureDocPublication: async () => {},
  isDocPublished: () => true,
}))
vi.mock('next-mdx-remote/rsc', () => ({ compileMDX: vi.fn() }))
vi.mock('@/lib/mdx-interpret', () => ({ interpretMDX: vi.fn() }))
vi.mock('@/mdx/remark', () => ({ remarkPlugins: [] }))
vi.mock('@/mdx/rehype', () => ({ rehypePlugins: [] }))
vi.mock('@/components/mdx/mdx-components', () => ({ useMDXComponents: () => ({}) }))
vi.mock('@/mdx/snippet-registry', () => ({ resolveSnippetComponent: vi.fn() }))
vi.mock('@/lib/content-source', () => ({
  getContentSource: () => ({
    kind: 'filesystem',
    exists: async (path: string) => fixture.files.has(path),
    read: async (path: string) => fixture.files.get(path) ?? null,
  }),
}))
vi.mock('@/generated/runtime-docs', () => ({
  runtimeDocs: {
    'src/content/fr/guide.mdx': {
      component: () => null,
      frontmatter: { title: 'Guide français' },
    },
    'src/content/fr/human-guide.mdx': {
      component: () => null,
      frontmatter: { title: 'Guide humain' },
    },
  },
}))

import { getDocFromParams } from './get-doc'
import { findDocSource, getIndexableDocTranslation, hasDocTranslation } from '@/lib/i18n/translation-source'
import { getContentSource } from '@/lib/content-source'

const primary = '---\ntitle: Guide\n---\nSource content\n'
const primaryPath = 'src/content/guide.mdx'
const translationPath = 'src/content/fr/guide.mdx'

beforeEach(() => {
  fixture.files.clear()
  fixture.files.set(primaryPath, { content: primary, modifiedAtMs: 100 })
})

describe('translated document eligibility', () => {
  it('rejects traversing route segments before reading content', async () => {
    fixture.files.set('src/content/../secret.mdx', { content: primary, modifiedAtMs: 100 })
    expect(await getDocFromParams(['..', 'secret'])).toBeNull()
    expect(await hasDocTranslation(['..', 'secret'], 'fr')).toBe(false)
  })

  it('rejects a translation whose source page was removed', async () => {
    fixture.files.set('src/content/fr/orphan.mdx', { content: '---\ntitle: Français\n---\nTexte', modifiedAtMs: 200 })
    expect(await hasDocTranslation(['orphan'], 'fr')).toBe(false)
    expect(await getIndexableDocTranslation(['orphan'], 'fr')).toBeNull()
    expect(await getDocFromParams(['orphan'], 'fr')).toBeNull()
  })

  it('omits a translated page with its own noindex policy', async () => {
    fixture.files.set(translationPath, {
      content: '---\ntitle: Guide français\nnoindex: true\n---\nTexte',
      modifiedAtMs: 200,
    })
    expect(await hasDocTranslation(['guide'], 'fr')).toBe(true)
    expect(await getIndexableDocTranslation(['guide'], 'fr')).toBeNull()
  })

  it('inherits a newly private indexing policy from the source page', async () => {
    fixture.files.set(primaryPath, {
      content: '---\ntitle: Guide\nnoindex: true\n---\nSource content',
      modifiedAtMs: 300,
    })
    fixture.files.set(translationPath, {
      content: '---\ntitle: Guide français\n---\nTexte',
      modifiedAtMs: 200,
    })
    expect(await getIndexableDocTranslation(['guide'], 'fr')).toBeNull()
  })

  it('uses source hashes for generated translation freshness', async () => {
    const hash = createHash('sha256').update(primary).digest('hex')
    fixture.files.set(translationPath, {
      content: `---\ntitle: Guide français\n---\n{/* thally:ai-translation locale=fr source-sha=${hash} */}\nTexte`,
      modifiedAtMs: 1,
    })
    expect(await getDocFromParams(['guide'], 'fr')).toMatchObject({ isStale: false })
    fixture.files.set(primaryPath, { content: `${primary}Updated source`, modifiedAtMs: 2 })
    expect(await getIndexableDocTranslation(['guide'], 'fr')).not.toBeNull()
    expect(await findDocSource(getContentSource(), 'guide', 'fr')).toMatchObject({ isStale: true })
  })

  it('does not infer human translation freshness from deployment mtimes', async () => {
    fixture.files.set('src/content/human-guide.mdx', { content: primary, modifiedAtMs: 100 })
    fixture.files.set('src/content/fr/human-guide.mdx', {
      content: '---\ntitle: Guide humain\n---\nTexte',
      modifiedAtMs: 1,
    })
    expect(await getDocFromParams(['human-guide'], 'fr')).toMatchObject({ isStale: false })
  })

  it('derives reader access from the files it resolved, translation and primary together', async () => {
    fixture.files.set(primaryPath, { content: '---\ntitle: Guide\ngroups: [beta]\n---\nSource content', modifiedAtMs: 100 })
    fixture.files.set(translationPath, { content: '---\ntitle: Guide français\n---\nTexte', modifiedAtMs: 200 })
    // A fresh module: earlier cases cached this route's document.
    vi.resetModules()
    const { getDocFromParams: freshGetDoc } = await import('./get-doc')
    const translated = await freshGetDoc(['guide'], 'fr')
    // The translation omits `groups`; the primary's restriction still applies.
    expect(translated?.access).toEqual({ groupSets: [['beta']], isMalformed: false })
  })

  it('never resolves a file-suffixed route to its file', async () => {
    fixture.files.set('src/content/locked.mdx', { content: '---\ntitle: Locked\ngroups: [beta]\n---\nTOPSECRET', modifiedAtMs: 100 })
    expect(await getDocFromParams(['locked.mdx'])).toBeNull()
    expect(await getDocFromParams(['locked.MD'])).toBeNull()
  })

  it('fails closed when the resolved frontmatter cannot be parsed', async () => {
    fixture.files.set('src/content/broken.mdx', { content: '---\ntitle: [unclosed\n---\nBody', modifiedAtMs: 100 })
    const doc = await getDocFromParams(['broken']).catch(() => null)
    // Either the page fails to load, or it loads with access nobody satisfies.
    expect(doc === null || doc.access?.isMalformed === true).toBe(true)
  })
})
