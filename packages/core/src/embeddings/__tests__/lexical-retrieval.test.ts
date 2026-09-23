/**
 * Regression coverage for Ask AI retrieval ranking.
 *
 * The reported failure: "Does Thally have a <Table> component and if not how
 * do you create Tables with Thally" retrieved only CLI pages, because the
 * product name appears on every page and the hashed bag-of-words ranking had
 * no notion of word rarity. The model then refused a question the docs answer.
 */

import { describe, expect, it } from 'vitest'
import { parseMdxContent } from '../../content/parse'
import { chunkDocument } from '../chunk'
import { buildEmbeddingIndex } from '../index-store'
import { lexicalTerms, stemTerm } from '../lexical'
import { localHashProvider } from '../provider'
import { rankIndexedChunks } from '../retrieve'
import type { EmbeddingIndex, EmbeddingProvider } from '../types'
import type { PageSource } from '../index-store'

function pageSource(pageId: string, title: string, rawBody: string): PageSource {
  return {
    pageId,
    href: `/${pageId}`,
    title,
    rawBody,
    chunks: chunkDocument({
      pageId,
      href: `/${pageId}`,
      title,
      sections: parseMdxContent(rawBody).sections,
    }),
  }
}

const pages: Array<PageSource> = [
  pageSource('guides/writing-content', 'Create and edit pages', `## Code blocks

Fenced code blocks get syntax highlighting.

## Tables

Standard Markdown tables render with proper styling:

\`\`\`mdx
| Method | Endpoint |
| --- | --- |
| GET | /pets |
\`\`\`
`),
  pageSource('guides/cli-overview', 'CLI overview', `## Thally and create-thally-docs

Use create-thally-docs to create a new Thally site. The thally CLI runs
Thally checks, Thally previews, and Thally builds for every Thally component.
`),
  pageSource('guides/cli-reference', 'CLI reference', `## Commands

Thally commands create, check, and build a Thally site. Run thally --help.
`),
  pageSource('guides/deploy-vercel', 'Deploy to Vercel', `## Deploy

Import the repository in Vercel and deploy the Thally site.
`),
  pageSource('guides/deploy-cloudflare', 'Deploy to Cloudflare', `## Deploy

Run the Worker deploy command to publish the Thally site to Cloudflare.
`),
]

async function localIndex(): Promise<EmbeddingIndex> {
  return buildEmbeddingIndex({ sources: pages, provider: localHashProvider, noCache: true })
}

describe('stemTerm', () => {
  it('folds plurals onto their singular', () => {
    expect(stemTerm('tables')).toBe('table')
    expect(stemTerm('libraries')).toBe('library')
    expect(stemTerm('boxes')).toBe('box')
    expect(stemTerm('embeds')).toBe('embed')
  })

  it('keeps tense forms and words that only look plural', () => {
    expect(stemTerm('settings')).toBe('setting')
    expect(stemTerm('embedded')).toBe('embedded')
    expect(stemTerm('access')).toBe('access')
    expect(stemTerm('status')).toBe('status')
    expect(stemTerm('analysis')).toBe('analysis')
  })

  it('leaves short words and numbers alone', () => {
    expect(stemTerm('api')).toBe('api')
    expect(stemTerm('404')).toBe('404')
  })
})

describe('lexicalTerms', () => {
  it('drops function words and markup punctuation', () => {
    expect(lexicalTerms('Does it have a <Table> component?')).toEqual([
      stemTerm('table'),
      stemTerm('component'),
    ])
  })
})

describe('rankIndexedChunks (lexical)', () => {
  it('ranks the Tables section first despite the product name on every page', async () => {
    const results = rankIndexedChunks(
      'Does Thally have a <Table> Component and if not how do you create Tables with Thally',
      await localIndex(),
      null,
      { k: 3, tokenBudget: 4_000 },
    )
    expect(results[0]?.chunk.pageId).toBe('guides/writing-content')
    expect(results[0]?.chunk.anchor).toBe('tables')
  })

  it('keeps scores in [0, 1) and omits chunks with no matching words', async () => {
    const results = rankIndexedChunks('markdown tables', await localIndex(), null, { k: 10, tokenBudget: 10_000 })
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      expect(result.score).toBeGreaterThan(0)
      expect(result.score).toBeLessThan(1)
    }
    expect(results.every((result) => result.chunk.text.toLowerCase().includes('table'))).toBe(true)
  })

  it('uses earlier conversation only to break ties within the current question', async () => {
    const index = await localIndex()
    const followUp = rankIndexedChunks('And on Vercel?', index, null, {
      k: 1,
      context: 'How do I deploy to Cloudflare?',
    })
    expect(followUp[0]?.chunk.pageId).toBe('guides/deploy-vercel')

    const vague = rankIndexedChunks('How do I do that?', index, null, {
      k: 1,
      context: 'How do I deploy to Cloudflare?',
    })
    expect(vague[0]?.chunk.pageId).toBe('guides/deploy-cloudflare')
  })

  it('caps chunks per page so one page cannot fill every slot', async () => {
    const results = rankIndexedChunks('Thally site', await localIndex(), null, {
      k: 10,
      tokenBudget: 10_000,
      maxPerPage: 1,
    })
    const pageIds = results.map((result) => result.chunk.pageId)
    expect(new Set(pageIds).size).toBe(pageIds.length)
  })

  it('strips embeddings from results', async () => {
    const [result] = rankIndexedChunks('tables', await localIndex(), null, { k: 1 })
    expect(result && 'embedding' in result.chunk).toBe(false)
  })
})

describe('rankIndexedChunks (hybrid)', () => {
  // A stand-in semantic provider: it "understands" that hosting means
  // deploying, which no lexical ranker can know.
  const semanticProvider: EmbeddingProvider = {
    id: 'test-semantic',
    dimensions: 2,
    async embed(texts) {
      return texts.map((text) => (/deploy|host/i.test(text) ? [1, 0] : [0, 1]))
    },
  }

  it('fuses semantic matches the lexical ranker cannot see', async () => {
    const index = await buildEmbeddingIndex({ sources: pages, provider: semanticProvider, noCache: true })
    const [queryVector] = await semanticProvider.embed(['Where can I host it?'])
    const results = rankIndexedChunks('Where can I host it?', index, queryVector, { k: 2 })
    expect(results).toHaveLength(2)
    for (const result of results) expect(result.chunk.pageId).toMatch(/^guides\/deploy-/)
    expect(results[0]?.score).toBeLessThanOrEqual(1)
  })
})
