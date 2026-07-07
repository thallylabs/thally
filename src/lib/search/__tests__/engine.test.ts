import { describe, expect, it } from 'vitest'
import { buildSearchCorpus } from '@/lib/search/corpus'
import { searchDocs } from '@/lib/search/engine'

function pickBodyWord(): string | null {
  for (const record of buildSearchCorpus()) {
    const words = record.body.match(/[a-z]{6,}/gi)
    if (words && words.length) return words[0].toLowerCase()
  }
  return null
}

describe('search engine', () => {
  it('builds a corpus that includes body content', () => {
    const corpus = buildSearchCorpus()
    expect(corpus.length).toBeGreaterThan(0)
    expect(corpus.some((record) => record.body.length > 0)).toBe(true)
  })

  it('returns body-content matches (hybrid)', async () => {
    const word = pickBodyWord()
    expect(word).toBeTruthy()
    const hits = await searchDocs(word as string, { mode: 'hybrid', limit: 5 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]).toHaveProperty('href')
    expect(hits[0]).toHaveProperty('snippet')
  })

  it('tolerates a typo in full-text mode', async () => {
    const word = pickBodyWord()
    expect(word).toBeTruthy()
    // Flip one character to simulate a typo.
    const typo = `${(word as string).slice(0, -1)}x`
    const hits = await searchDocs(typo, { mode: 'fulltext', limit: 5 })
    expect(hits.length).toBeGreaterThan(0)
  })
})
