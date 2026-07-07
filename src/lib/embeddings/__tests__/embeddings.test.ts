import { describe, expect, it } from 'vitest'
import type { ContentSection } from '@/lib/content/types'
import { chunkDocument } from '@/lib/embeddings/chunk'
import { embedLocal, localHashProvider } from '@/lib/embeddings/provider'
import { buildEmbeddingIndex } from '@/lib/embeddings/index-store'
import { rankChunks } from '@/lib/embeddings/retrieve'
import type { PageSource } from '@/lib/embeddings/index-store'

function section(partial: Partial<ContentSection> & { id: string; title: string }): ContentSection {
  return { depth: 2, headingPath: [partial.title], text: '', code: [], ...partial }
}

describe('embedLocal', () => {
  it('is deterministic and fixed-dimensional', () => {
    const a = embedLocal('configure your api key')
    const b = embedLocal('configure your api key')
    expect(a).toEqual(b)
    expect(a).toHaveLength(localHashProvider.dimensions)
  })

  it('scores related text higher than unrelated text', () => {
    const query = embedLocal('how to configure authentication tokens')
    const related = embedLocal('set the authentication token to configure access')
    const unrelated = embedLocal('bananas grow on tropical trees in warm climates')
    const cos = (x: number[], y: number[]) => x.reduce((sum, v, i) => sum + v * y[i], 0)
    expect(cos(query, related)).toBeGreaterThan(cos(query, unrelated))
  })
})

describe('chunkDocument', () => {
  it('creates anchored chunks from sections', () => {
    const chunks = chunkDocument({
      pageId: 'guides/auth',
      href: '/guides/auth',
      title: 'Authentication',
      sections: [
        section({ id: 'overview-section', title: 'Overview', text: 'Auth lets agents act on behalf of users.' }),
        section({
          id: 'tokens',
          title: 'Tokens',
          headingPath: ['Authentication', 'Tokens'],
          text: 'Use a bearer token.',
        }),
      ],
    })
    expect(chunks).toHaveLength(2)
    expect(chunks[1]).toMatchObject({ anchor: 'tokens', heading: 'Tokens', pageId: 'guides/auth' })
    expect(chunks[1].text).toContain('Authentication > Tokens')
    expect(chunks[1].tokens).toBeGreaterThan(0)
  })
})

describe('buildEmbeddingIndex + rankChunks', () => {
  const sources: Array<PageSource> = [
    {
      pageId: 'guides/auth',
      href: '/guides/auth',
      title: 'Authentication',
      rawBody: 'auth body v1',
      chunks: chunkDocument({
        pageId: 'guides/auth',
        href: '/guides/auth',
        title: 'Authentication',
        sections: [section({ id: 'tokens', title: 'Tokens', text: 'Use a bearer token to authenticate requests.' })],
      }),
    },
    {
      pageId: 'guides/deploy',
      href: '/guides/deploy',
      title: 'Deploy',
      rawBody: 'deploy body v1',
      chunks: chunkDocument({
        pageId: 'guides/deploy',
        href: '/guides/deploy',
        title: 'Deploy',
        sections: [section({ id: 'vercel', title: 'Vercel', text: 'Deploy your docs to Vercel with one command.' })],
      }),
    },
  ]

  it('embeds chunks and retrieves the most relevant one', async () => {
    const index = await buildEmbeddingIndex({ sources, provider: localHashProvider, noCache: true })
    expect(index.chunks.every((chunk) => chunk.embedding.length === localHashProvider.dimensions)).toBe(true)

    const query = embedLocal('how do I authenticate requests with a bearer token')
    const results = rankChunks(query, index.chunks, { k: 1 })
    expect(results).toHaveLength(1)
    expect(results[0].chunk.pageId).toBe('guides/auth')
    // Returned chunks must not leak the embedding vector.
    expect('embedding' in results[0].chunk).toBe(false)
  })

  it('respects the token budget', async () => {
    const index = await buildEmbeddingIndex({ sources, provider: localHashProvider, noCache: true })
    const query = embedLocal('deploy authenticate token vercel')
    const results = rankChunks(query, index.chunks, { tokenBudget: 1, k: 10 })
    // With a tiny budget only the single best chunk comes back.
    expect(results).toHaveLength(1)
  })
})
