/** Regression coverage for readiness facts over embedded and managed content. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getContentDocument: vi.fn(),
  loadContentDocument: vi.fn(),
  loadDocEntries: vi.fn(),
  getDocEntries: vi.fn(),
  docsConfig: vi.fn(() => ({ tabs: [] }) as Record<string, unknown>),
  apiReferenceConfig: { specs: [] as Array<unknown>, defaultSpecId: 'default' },
  getAllApiOperationNodes: vi.fn(),
}))

vi.mock('@/lib/content', () => ({
  getContentDocument: mocks.getContentDocument,
  loadContentDocument: mocks.loadContentDocument,
}))

vi.mock('@/data/docs', () => ({
  getDocEntries: mocks.getDocEntries,
  loadDocEntries: mocks.loadDocEntries,
  getNavigablePageIds: () => new Set(['quickstart', 'guides/links']),
  getBreadcrumbs: () => [{ label: 'Guides', href: '/quickstart' }, { label: 'Page' }],
  getCurrentVersionPageIds: () => null,
  getI18nConfig: () => ({ defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }, { code: 'es', label: 'Español' }] }),
  getRedirectsConfig: () => [{ source: '/old/:slug*', destination: '/quickstart' }],
}))

vi.mock('@/lib/docs-json-config', () => ({ getDocsJsonConfig: mocks.docsConfig }))
vi.mock('@/config/api-reference', () => ({ apiReferenceConfig: mocks.apiReferenceConfig }))
vi.mock('@/data/api-reference', () => ({ getAllApiOperationNodes: mocks.getAllApiOperationNodes }))

import {
  gatherPageFacts,
  gatherReadinessFacts,
  isPubliclyListedPage,
  loadPageFacts,
  operationExampleFact,
} from '@/lib/agent-readiness/gather'
import type { NormalizedOperation } from '@/lib/openapi/types'

function entry(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    href: `/${id}`,
    title: id,
    description: '',
    keywords: [id],
    openapi: null,
    lastUpdated: '',
    ...overrides,
  }
}

const RUNTIME_DOCUMENT = {
  pageId: 'quickstart',
  frontmatter: {},
  rawBody: '# Quickstart\n\nConfigure the integration.',
  content: {
    headings: [{ depth: 1, text: 'Quickstart', id: 'quickstart' }],
    text: 'Configure the integration.'.repeat(12),
    markdown: '# Quickstart\n\nConfigure the integration.',
    codeBlocks: [],
    sections: [],
    links: [],
  },
}

const LINKS_DOCUMENT = {
  pageId: 'guides/links',
  frontmatter: {},
  rawBody: '<div id="custom-anchor" />\n## Setup',
  content: {
    headings: [{ depth: 2, text: 'Setup', id: 'setup' }],
    text: 'Links.',
    markdown: '## Setup\n\n```\nplain\n```\n\n```bash\nnpm i\n```',
    codeBlocks: [
      { language: 'text', hasLanguageTag: false, source: 'plain', index: 0 },
      { language: 'bash', hasLanguageTag: true, source: 'npm i', index: 1 },
    ],
    sections: [{ id: 'setup', title: 'Setup', depth: 2, headingPath: ['Setup'], text: 'x'.repeat(8_000), code: [] }],
    links: [
      { url: '/quickstart', text: 'ok' },
      { url: '/quickstart#quickstart', text: 'ok anchor' },
      { url: '/quickstart#nope', text: 'bad anchor' },
      { url: '/missing-page', text: 'dead' },
      { url: '#setup', text: 'own anchor' },
      { url: '#custom-anchor', text: 'jsx anchor' },
      { url: '#absent', text: 'own missing' },
      { url: '/es/quickstart', text: 'translated' },
      { url: '/old/anything/here', text: 'redirected' },
      { url: '/openapi.yaml', text: 'static file' },
      { url: '/api/search', text: 'runtime route' },
      { url: '/reference/create-user#body-name', text: 'operation panel anchor' },
      { url: 'https://example.com/x', text: 'external' },
      { url: 'relative/page', text: 'relative' },
    ],
  },
}

describe('agent readiness page facts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.apiReferenceConfig.specs = []
    mocks.docsConfig.mockReturnValue({ tabs: [] })
    mocks.getDocEntries.mockReturnValue([entry('quickstart', { title: 'Quickstart' })])
    mocks.getContentDocument.mockReturnValue(null)
    mocks.loadContentDocument.mockResolvedValue(RUNTIME_DOCUMENT)
    mocks.loadDocEntries.mockResolvedValue([
      entry('quickstart', {
        title: 'Published quickstart',
        description: 'Metadata loaded from the active release content index.',
        keywords: ['published', 'quickstart'],
      }),
    ])
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

  it('scores metadata from the active release content index', async () => {
    expect(gatherPageFacts()[0]).toMatchObject({
      title: 'Quickstart',
      description: '',
    })

    await expect(loadPageFacts()).resolves.toEqual([
      expect.objectContaining({
        title: 'Published quickstart',
        description: 'Metadata loaded from the active release content index.',
        keywords: ['published', 'quickstart'],
      }),
    ])
    expect(mocks.loadDocEntries).toHaveBeenCalledOnce()
  })

  it('resolves internal links and anchors from the content graph conservatively', () => {
    mocks.getDocEntries.mockReturnValue([
      entry('quickstart'),
      entry('guides/links'),
      entry('reference/create-user', { openapi: { method: 'POST', path: '/users' } }),
    ])
    mocks.getContentDocument.mockImplementation((id: string) => (id === 'guides/links' ? LINKS_DOCUMENT : RUNTIME_DOCUMENT))
    const fact = gatherPageFacts().find((page) => page.pageId === 'guides/links')!
    expect(fact.brokenLinks).toEqual([
      { target: '/quickstart#nope', kind: 'anchor' },
      { target: '/missing-page', kind: 'page' },
      { target: '#absent', kind: 'anchor' },
    ])
  })

  it('derives code-tag, size, section, and JSON-LD facts', () => {
    mocks.getDocEntries.mockReturnValue([
      entry('guides/links', { title: 'Links', lastUpdated: 'yesterday', lastVerified: '2026-09-01' }),
    ])
    mocks.getContentDocument.mockReturnValue(LINKS_DOCUMENT)
    const [fact] = gatherPageFacts()
    expect(fact).toMatchObject({
      codeBlocksCount: 2,
      untaggedCodeBlocks: 1,
      approxTokens: Math.ceil(LINKS_DOCUMENT.content.markdown.length / 4),
      largestSection: { title: 'Setup', approxTokens: 2_000 },
      headingDepths: [2],
      lastVerified: '2026-09-01',
    })
    expect(fact.jsonLdIssues).toEqual([
      expect.objectContaining({ severity: 'fail', message: expect.stringMatching(/dateModified/) }),
    ])
  })

  it('reports unknown code tags when the engine predates hasLanguageTag', () => {
    mocks.getContentDocument.mockReturnValue({
      ...RUNTIME_DOCUMENT,
      content: { ...RUNTIME_DOCUMENT.content, codeBlocks: [{ language: 'text', source: 'x', index: 0 }] },
    })
    expect(gatherPageFacts()[0]).toMatchObject({ codeBlocksCount: 1, untaggedCodeBlocks: undefined })
  })
})

describe('site-level readiness facts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.apiReferenceConfig.specs = []
    mocks.docsConfig.mockReturnValue({ tabs: [] })
    mocks.getDocEntries.mockReturnValue([entry('quickstart'), entry('introduction', { href: '/' }), entry('secret', { noindex: true })])
    mocks.getContentDocument.mockReturnValue(RUNTIME_DOCUMENT)
  })

  it('skips OpenAPI and golden questions when neither is configured', async () => {
    const search = vi.fn()
    const facts = await gatherReadinessFacts({ source: 'embedded', search })
    expect(facts.operations).toBeNull()
    expect(facts.retrieval).toBeNull()
    expect(search).not.toHaveBeenCalled()
  })

  it('runs golden questions against the search seam with canonical hrefs', async () => {
    mocks.docsConfig.mockReturnValue({
      tabs: [],
      readiness: {
        topK: 3,
        goldenQuestions: [
          { question: 'Where do I start?', expect: ['introduction'] },
          { question: 'How do I configure it?', expect: '/quickstart/' },
          { question: 'What is secret?', expect: ['secret'] },
        ],
      },
    })
    const search = vi.fn(async (query: string) => (query.startsWith('Where') ? ['/', '/quickstart'] : ['/other']))
    const facts = await gatherReadinessFacts({ source: 'embedded', search })
    expect(search).toHaveBeenCalledWith('Where do I start?', 3)
    expect(facts.retrieval?.results.map((result) => [result.expected, result.hit, result.unsearchable])).toEqual([
      [['/'], true, []],
      [['/quickstart'], false, []],
      [['/secret'], false, ['/secret']],
    ])
  })

  it('loads OpenAPI example facts and treats operation pages as valid link targets', async () => {
    mocks.apiReferenceConfig.specs = [{ id: 'default' }]
    mocks.getAllApiOperationNodes.mockResolvedValue([
      {
        href: '/api/default/users/post',
        operation: {
          specId: 'default',
          key: 'POST /users',
          title: 'Create a user',
          requestBody: { required: true, contents: [{ mediaType: 'application/json', examples: [], example: { name: 'Ada' } }] },
          responses: [{ code: '201', contents: [{ mediaType: 'application/json', examples: [] }] }],
        },
      },
    ])
    const facts = await gatherReadinessFacts({ source: 'embedded' })
    expect(facts.operations?.operations).toEqual([
      {
        key: 'default:POST /users',
        href: '/api/default/users/post',
        title: 'Create a user',
        hasRequestBody: true,
        hasRequestExample: true,
        hasSuccessContent: true,
        hasResponseExample: false,
      },
    ])
  })

  it('reports a spec that fails to load as an error instead of throwing', async () => {
    mocks.apiReferenceConfig.specs = [{ id: 'default' }]
    mocks.getAllApiOperationNodes.mockRejectedValue(new Error('fetch failed: https://internal.example/spec'))
    const facts = await gatherReadinessFacts({ source: 'embedded' })
    expect(facts.operations).toEqual({ operations: [], error: 'The OpenAPI specification could not be loaded.' })
  })
})

describe('operationExampleFact', () => {
  const base = {
    specId: 'default',
    key: 'GET /items',
    title: 'List items',
    responses: [],
  } as unknown as NormalizedOperation

  it('accepts schema-level examples and ignores non-2xx responses', () => {
    const fact = operationExampleFact({
      ...base,
      responses: [
        { code: '200', contents: [{ mediaType: 'application/json', examples: [], schema: { type: 'array', example: [] } }] },
        { code: '404', contents: [{ mediaType: 'application/json', examples: [], example: { error: 'x' } }] },
      ],
    }, '/api/default/items/get')
    expect(fact).toMatchObject({ hasRequestBody: false, hasSuccessContent: true, hasResponseExample: true })
  })

  it('does not require examples for operations without request or success content', () => {
    const fact = operationExampleFact({ ...base, responses: [{ code: '204', contents: [] }] }, '/x')
    expect(fact).toMatchObject({ hasRequestBody: false, hasSuccessContent: false })
  })
})

describe('isPubliclyListedPage', () => {
  it('withholds hidden and noindex pages and marks their facts unlisted', () => {
    expect(isPubliclyListedPage({})).toBe(true)
    expect(isPubliclyListedPage({ hidden: true })).toBe(false)
    expect(isPubliclyListedPage({ noindex: true })).toBe(false)

    mocks.getDocEntries.mockReturnValue([entry('quickstart'), entry('drafts', { hidden: true }), entry('old', { noindex: true })])
    mocks.getContentDocument.mockReturnValue(RUNTIME_DOCUMENT)
    expect(Object.fromEntries(gatherPageFacts().map((fact) => [fact.pageId, fact.unlisted]))).toEqual({
      quickstart: false,
      drafts: true,
      old: true,
    })
  })
})
