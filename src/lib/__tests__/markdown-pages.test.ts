/** Effective `.md` page configuration across repository and Cloud settings. */

import { describe, expect, it } from 'vitest'

import {
  isMarkdownPagesEnabled,
  isRepositoryMarkdownPagesEnabled,
} from '@/lib/markdown-pages'

describe('Markdown page URLs', () => {
  it('is disabled by default in the repository scaffold', () => {
    expect(isRepositoryMarkdownPagesEnabled()).toBe(false)
    expect(isMarkdownPagesEnabled()).toBe(false)
  })

  it('lets an explicit Cloud setting override the repository default', () => {
    expect(isMarkdownPagesEnabled({ markdown: { enabled: true } })).toBe(true)
    expect(isMarkdownPagesEnabled({ markdown: { enabled: false } })).toBe(false)
  })
})
