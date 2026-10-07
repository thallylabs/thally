/** Section-level retrieval, supplemental records and section anchors on page hits. */
import { afterEach, describe, expect, it } from 'vitest'
import { registerAsyncContentDocumentSource } from '../content/source-registry.js'
import { parseMdxContent } from '../content/parse.js'
import { registerAsyncDocEntriesSource } from '../doc-source.js'
import { fullTextQuery, resetSearchEngine, searchDocs } from './engine.js'
import { searchSections } from './sections.js'
import { registerSupplementalSearchRecordsSource } from './supplemental.js'

const pages: Record<string, { title: string; body: string }> = {
  'guides/auth': {
    title: 'Authentication',
    body: `Overview of auth.\n\n## API keys\n\nCreate an API key in the dashboard and rotate it monthly.\n\n## Webhooks\n\nVerify the webhook signature header.`,
  },
  'guides/deploy': { title: 'Deploying', body: '## Vercel\n\nPush to main to deploy.' },
}

function registerFixture() {
  registerAsyncDocEntriesSource(async () => Object.entries(pages).map(([id, page]) => ({
    id, title: page.title, description: '', keywords: [], href: `/${id}`,
  })))
  registerAsyncContentDocumentSource(async (pageId) => {
    const page = pages[pageId]
    return page ? { pageId, frontmatter: {}, rawBody: page.body, content: parseMdxContent(page.body, 'agents') } : null
  })
}

afterEach(() => {
  registerSupplementalSearchRecordsSource(async () => [])
  resetSearchEngine()
})

describe('searchSections', () => {
  it('returns the matching section with heading path, anchor and body', async () => {
    registerFixture()
    resetSearchEngine()
    const [hit] = await searchSections('rotate api key')
    expect(hit).toMatchObject({
      pageId: 'guides/auth',
      href: '/guides/auth',
      heading: 'API keys',
      headingPath: ['API keys'],
      anchor: 'api-keys',
    })
    expect(hit.content).toContain('rotate it monthly')
    expect(hit.content.startsWith('API keys\n')).toBe(false)
  })

  it('returns nothing for an empty query', async () => {
    registerFixture()
    expect(await searchSections('   ')).toEqual([])
  })
})

describe('searchDocs', () => {
  it('points a page hit at its best-matching section', async () => {
    registerFixture()
    resetSearchEngine()
    const [hit] = await searchDocs('webhook signature', { mode: 'fulltext' })
    expect(hit).toMatchObject({ pageId: 'guides/auth', type: 'page', anchor: 'webhooks', heading: 'Webhooks' })
    expect(hit.snippet).toContain('signature')
  })

  it('indexes supplemental API operations beside pages', async () => {
    registerFixture()
    registerSupplementalSearchRecordsSource(async () => [{
      id: 'api/default/users/list', type: 'api_operation', title: 'List users', description: 'GET /users',
      href: '/api/default/users/list', keywords: ['users'], method: 'GET', path: '/users',
    }])
    resetSearchEngine()
    const [hit] = await searchDocs('list users', { mode: 'fulltext' })
    expect(hit).toMatchObject({ type: 'api_operation', method: 'GET', path: '/users', href: '/api/default/users/list' })
  })

  it('keeps searching when the supplemental source fails', async () => {
    registerFixture()
    registerSupplementalSearchRecordsSource(async () => { throw new Error('spec unreachable') })
    resetSearchEngine()
    expect((await searchDocs('deploy', { mode: 'fulltext' }))[0]?.pageId).toBe('guides/deploy')
  })
})

describe('natural-language queries', () => {
  it('keeps only meaningful words for full-text ranking', () => {
    expect(fullTextQuery('How do I add a page to the sidebar navigation?')).toBe('add page sidebar navigation?')
    expect(fullTextQuery('How do I set THALLY_EMBEDDING_PROVIDER?')).toBe('set THALLY_EMBEDDING_PROVIDER?')
    expect(fullTextQuery('how do I')).toBe('how do I')
  })

  it('ranks the page that answers a question, not the one full of function words', async () => {
    pages['guides/filler'] = {
      title: 'Overview',
      body: 'How do you do it? How do I know? It is what it is, and so on. How do I do this and that, to the end of it.',
    }
    pages['guides/navigation'] = { title: 'Configure navigation', body: '## Sidebar\n\nAdd a page to the sidebar navigation in docs.json.' }
    registerFixture()
    resetSearchEngine()
    const [hit] = await searchDocs('How do I add a page to the sidebar navigation?', { mode: 'fulltext' })
    expect(hit.pageId).toBe('guides/navigation')
    delete pages['guides/filler']
    delete pages['guides/navigation']
  })

  it('still matches identifiers the index kept whole', async () => {
    pages['guides/env'] = { title: 'Environment', body: 'Set THALLY_EMBEDDING_PROVIDER to openai for hosted vectors.' }
    pages['guides/other'] = { title: 'Embedding providers', body: 'Thally embedding provider overview and choices.' }
    registerFixture()
    resetSearchEngine()
    for (const query of ['THALLY_EMBEDDING_PROVIDER', 'How do I set THALLY_EMBEDDING_PROVIDER?']) {
      expect((await searchDocs(query, { mode: 'fulltext' }))[0]?.pageId, query).toBe('guides/env')
    }
    delete pages['guides/env']
    delete pages['guides/other']
  })
})
