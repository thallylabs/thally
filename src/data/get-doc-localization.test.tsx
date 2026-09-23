/** Locale indexing and freshness must follow actual source and translation bytes. */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ files: new Map<string, { content: string; modifiedAtMs: number }>() }))

vi.mock('@/data/docs', () => ({
  deriveTitleFromSlug: (slug: string) => slug,
  getI18nConfig: () => ({ defaultLocale: 'en' }),
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

import { getDocFromParams, getIndexableDocTranslation, hasDocTranslation } from './get-doc'

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
  })

  it('does not infer human translation freshness from deployment mtimes', async () => {
    fixture.files.set('src/content/human-guide.mdx', { content: primary, modifiedAtMs: 100 })
    fixture.files.set('src/content/fr/human-guide.mdx', {
      content: '---\ntitle: Guide humain\n---\nTexte',
      modifiedAtMs: 1,
    })
    expect(await getDocFromParams(['human-guide'], 'fr')).toMatchObject({ isStale: false })
  })
})
