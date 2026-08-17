/** Regression coverage for readiness over managed asset-backed content. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getContentDocument: vi.fn(),
  loadContentDocument: vi.fn(),
}))

vi.mock('@/lib/content', () => ({
  getContentDocument: mocks.getContentDocument,
  loadContentDocument: mocks.loadContentDocument,
}))

vi.mock('@/data/docs', () => ({
  getDocEntries: () => [
    {
      id: 'quickstart',
      href: '/quickstart',
      title: 'Quickstart',
      description: 'Ship the first integration.',
      keywords: ['quickstart'],
      openapi: null,
    },
  ],
  getNavigablePageIds: () => new Set(['quickstart']),
}))

import { gatherPageFacts, loadPageFacts } from '@/lib/agent-readiness/gather'

const RUNTIME_DOCUMENT = {
  pageId: 'quickstart',
  frontmatter: {},
  rawBody: '# Quickstart\n\nConfigure the integration.',
  content: {
    headings: [{ depth: 1, text: 'Quickstart', id: 'quickstart' }],
    text: 'Configure the integration.'.repeat(12),
    codeBlocks: [],
  },
}

describe('agent readiness page facts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getContentDocument.mockReturnValue(null)
    mocks.loadContentDocument.mockResolvedValue(RUNTIME_DOCUMENT)
  })

  it('reads managed content through the async runtime source', async () => {
    expect(gatherPageFacts()[0]).toMatchObject({
      hasContentDoc: false,
      headingsCount: 0,
      textLength: 0,
    })

    await expect(loadPageFacts()).resolves.toEqual([
      expect.objectContaining({
        pageId: 'quickstart',
        hasContentDoc: true,
        headingsCount: 1,
        textLength: RUNTIME_DOCUMENT.content.text.length,
      }),
    ])
    expect(mocks.loadContentDocument).toHaveBeenCalledWith('quickstart')
  })
})
