/** Host content-source registration coverage for deployed runtimes. */

import { describe, expect, it, vi } from 'vitest'
import {
  getContentDocument,
  registerContentDocumentSource,
  type ContentDocument,
} from '../document'

describe('content document source', () => {
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
