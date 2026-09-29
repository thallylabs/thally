/** Source enumeration must not promote Cloud-selected locale files into source pages. */
import { describe, expect, it, vi } from 'vitest'

const files = vi.hoisted(() => new Map([
  ['src/content/guide.mdx', '---\ntitle: Guide\nnoindex: true\n---\nSource'],
  ['src/content/fr/guide.mdx', '---\ntitle: Guide français\n---\nTraduction'],
]))

vi.mock('@/lib/runtime-sources', () => ({
  listRuntimeSources: () => [...files.keys()],
  readRuntimeSource: (path: string) => files.get(path),
  runtimeSourceExists: (path: string) => files.has(path),
}))
vi.mock('@/lib/docs-json-config', () => ({
  getDocsJsonConfig: () => ({ tabs: [], i18n: { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }] } }),
  getDocsJsonConfigRevision: () => 1,
}))

import { getDocEntries } from './docs'

describe('source document enumeration', () => {
  it('excludes supported locale directories absent from docs.json and retains noindex', () => {
    expect(getDocEntries().map((entry) => entry.id)).toEqual(['guide'])
    expect(getDocEntries()[0]).toMatchObject({ noindex: true })
  })
})
