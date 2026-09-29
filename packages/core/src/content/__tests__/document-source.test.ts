/** Host content-source registration coverage for deployed runtimes. */

import { describe, expect, it, vi } from 'vitest'
import {
  getContentDocument,
  loadContentDocument,
  registerContentDocumentSource,
  registerAsyncContentDocumentSource,
  type ContentDocument,
} from '../document'
import { isSafeContentIdentifier } from '../identifiers'

describe('content document source', () => {
  it('rejects traversal and malformed locale paths before calling a host reader', async () => {
    const syncReader = vi.fn(() => null)
    const asyncReader = vi.fn(async () => null)
    registerContentDocumentSource(syncReader)
    registerAsyncContentDocumentSource(asyncReader)

    for (const pageId of ['../secret', 'guides/../../secret', '/absolute', 'guide\\secret', 'guide\u0000secret']) {
      expect(isSafeContentIdentifier(pageId)).toBe(false)
      expect(getContentDocument(pageId)).toBeNull()
      expect(await loadContentDocument(pageId)).toBeNull()
    }
    expect(getContentDocument('guides/install', '../fr')).toBeNull()
    expect(await loadContentDocument('guides/install', '../fr')).toBeNull()
    expect(isSafeContentIdentifier('指南/安装', 'zh-Hans')).toBe(true)
    expect(syncReader).not.toHaveBeenCalled()
    expect(asyncReader).not.toHaveBeenCalled()
  })

  it('uses the host reader when the project filesystem is unavailable', () => {
    const document: ContentDocument = {
      pageId: 'guides/runtime',
      frontmatter: { title: 'Runtime sources' },
      rawBody: '# Runtime sources',
      content: {
        headings: [],
        toc: [],
        sections: [],
        codeBlocks: [],
        links: [],
        text: 'Runtime sources',
        markdown: '# Runtime sources',
      },
    }
    const resolver = vi.fn(() => document)
    registerContentDocumentSource(resolver)

    expect(getContentDocument('guides/runtime')).toBe(document)
    expect(resolver).toHaveBeenCalledWith('guides/runtime', undefined)
  })
})
