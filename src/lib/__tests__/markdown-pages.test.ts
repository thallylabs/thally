/** Effective `.md` page configuration across repository and Cloud settings. */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isMarkdownPagesEnabled,
  isRepositoryMarkdownPagesEnabled,
} from '@/lib/markdown-pages'

afterEach(() => vi.unstubAllEnvs())

describe('Markdown page URLs', () => {
  it.each([true, false, undefined])('uses the repository setting %s when Cloud has no override', (enabled) => {
    vi.stubEnv('THALLY_DOCS_CONFIG', JSON.stringify({ tabs: [], markdown: { enabled } }))
    expect(isRepositoryMarkdownPagesEnabled()).toBe(enabled === true)
    expect(isMarkdownPagesEnabled()).toBe(enabled === true)
  })

  it('lets an explicit Cloud setting override the repository default', () => {
    expect(isMarkdownPagesEnabled({ markdown: { enabled: true } })).toBe(true)
    expect(isMarkdownPagesEnabled({ markdown: { enabled: false } })).toBe(false)
  })
})
