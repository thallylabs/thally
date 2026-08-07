/** Effective `.md` page configuration across repository and Cloud settings. */

import { describe, expect, it } from 'vitest'

import {
  isMarkdownPagesEnabled,
  isRepositoryMarkdownPagesEnabled,
} from '@/lib/markdown-pages'

describe('Markdown page URLs', () => {
  // Markdown mirrors are part of the agent-native default surface: the Copy
  // page menu, AI handoffs, and llms-oriented consumers all read them.
  it('is enabled by default in the repository scaffold', () => {
    expect(isRepositoryMarkdownPagesEnabled()).toBe(true)
    expect(isMarkdownPagesEnabled()).toBe(true)
  })

  it('lets an explicit Cloud setting override the repository default', () => {
    expect(isMarkdownPagesEnabled({ markdown: { enabled: true } })).toBe(true)
    expect(isMarkdownPagesEnabled({ markdown: { enabled: false } })).toBe(false)
  })
})
