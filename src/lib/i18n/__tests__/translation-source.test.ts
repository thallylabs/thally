/** Hostile locale and slug input must never select a file outside src/content. */

import { describe, expect, it, vi } from 'vitest'
import type { ContentSource } from '@/lib/content-source'
import { findDocSource } from '../translation-source'

vi.mock('@/data/docs', () => ({
  getI18nConfig: () => ({ defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'French' }] }),
}))
vi.mock('@/lib/content-source', () => ({ getContentSource: vi.fn() }))

function recordingSource(files: Array<string>) {
  const touched: Array<string> = []
  const source = {
    kind: 'filesystem',
    exists: async (path: string) => { touched.push(path); return files.includes(path) },
    read: async (path: string) => { touched.push(path); return files.includes(path) ? { content: '' } : null },
  } as unknown as ContentSource
  return { source, touched }
}

describe('findDocSource containment', () => {
  const files = ['src/content/guide.mdx', 'src/content/fr/guide.mdx', 'src/content/secret.mdx']
  const locales = ['../fr', '..%2Ffr', '%2e%2e%2f', '%252e%252e%252f', '..\\', 'fr/../..', 'fr%00', 'fr\u0000', '/etc/passwd', 'C:\\x', '\uFF46\uFF52', '\u0131', '', ' fr', 'fr\n', '__proto__']
  const slugs = ['../secret', 'guide/../secret', '..\\secret', 'guide\u0000', './guide', 'a//../secret']

  it.each(locales.map((value, index) => [index, value]))('returns null for locale #%s', async (_index, locale) => {
    const { source, touched } = recordingSource(files)
    expect(await findDocSource(source, 'guide', locale)).toBeNull()
    expect(touched).toEqual([])
  })

  it.each(slugs.map((value, index) => [index, value]))('returns null for slug #%s', async (_index, slug) => {
    for (const locale of [undefined, 'fr']) {
      const { source, touched } = recordingSource(files)
      expect(await findDocSource(source, slug, locale)).toBeNull()
      expect(touched).toEqual([])
    }
  })

  it('keeps encoded, absolute and oversized input as literal names below src/content', async () => {
    for (const [slug, locale] of [['%2e%2e/secret', undefined], ['/etc/passwd', 'fr'], ['guide', 'x'.repeat(200_000)]] as Array<[string, string | undefined]>) {
      const { source, touched } = recordingSource(files)
      const found = await findDocSource(source, slug, locale)
      expect(found === null || found.filePath === 'src/content/guide.mdx').toBe(true)
      for (const path of touched) expect(path).toMatch(/^src\/content\/[^\\\0]*$/)
      expect(touched.some((path) => path.includes('..'))).toBe(false)
    }
  })

  it('only reads below src/content for ordinary and prototype-named locales and slugs', async () => {
    for (const [slug, locale] of [['guide', 'fr'], ['guide', 'constructor'], ['__proto__', 'fr'], ['guide', 'FR'], ['guide', undefined]] as Array<[string, string | undefined]>) {
      const { source, touched } = recordingSource(files)
      await findDocSource(source, slug, locale)
      for (const path of touched) expect(path).toMatch(/^src\/content\/[^\\\0]*$/)
    }
  })
})
