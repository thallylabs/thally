/**
 * The local embedder and BM25 share one Unicode-aware tokenizer. English
 * ranking was tuned against the old `[a-z0-9]+` split, so ASCII input must
 * tokenize exactly as before; non-Latin locales must stop collapsing to zero
 * tokens.
 */

import { describe, expect, it } from 'vitest'
import { embedLocal, localHashProvider } from '../provider'
import { lexicalTerms } from '../lexical'
import { rankLexicalChunks } from '../retrieve'
import { wordTokens } from '../tokenize'
import type { Chunk } from '../types'

const legacySplit = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? []

describe('wordTokens', () => {
  it.each([
    'Set THALLY_EMBEDDING_PROVIDER=openai in .env',
    "Don't edit src/generated/runtime-sources.ts; it's rebuilt (v1.2.3).",
    'GET /api/v2/users?limit=10&cursor=abc_def — returns 200 OK',
    'e.g. foo-bar, baz.qux & 42x',
  ])('matches the legacy ASCII split for %j', (text) => {
    expect(wordTokens(text)).toEqual(legacySplit(text))
  })

  it('keeps accented Latin words whole', () => {
    expect(wordTokens('Configuración de la página')).toEqual(['configuración', 'de', 'la', 'página'])
  })

  it('tokenizes Cyrillic, Arabic and Devanagari (combining marks included)', () => {
    expect(wordTokens('Настройка поиска')).toEqual(['настройка', 'поиска'])
    expect(wordTokens('مرحبا الوثائق')).toEqual(['مرحبا', 'الوثائق'])
    expect(wordTokens('खोज सेटिंग')).toEqual(['खोज', 'सेटिंग'])
  })

  it('splits unspaced CJK runs into words instead of one giant token', () => {
    const tokens = wordTokens('安装文档和配置搜索')
    expect(tokens.length).toBeGreaterThan(1)
    expect(tokens.join('')).toBe('安装文档和配置搜索')
  })

  it('normalizes full-width forms (NFKC)', () => {
    expect(wordTokens('ＡＰＩ キー')).toEqual(['api', 'キー'])
  })
})

describe('Unicode-aware retrieval', () => {
  it('gives non-Latin text a non-zero local embedding', () => {
    expect(embedLocal('安装文档').some((value) => value !== 0)).toBe(true)
    expect(embedLocal('Настройка поиска').some((value) => value !== 0)).toBe(true)
  })

  it('bumps the local provider id so stale v2 vectors are discarded', () => {
    expect(localHashProvider.id).toBe('local-hash-v3')
  })

  it('stems only Latin terms', () => {
    expect(lexicalTerms('tables páginas')).toEqual(['table', 'página'])
    expect(lexicalTerms('поиска')).toEqual(['поиска'])
  })

  it('ranks Spanish, Russian and Chinese sections with BM25', () => {
    const chunk = (pageId: string, text: string): Chunk => ({
      id: pageId, pageId, href: `/${pageId}`, title: pageId, heading: pageId, headingPath: [pageId], anchor: '', text, tokens: 10,
    })
    const chunks = [
      chunk('es', 'La configuración de búsqueda admite varios idiomas.'),
      chunk('ru', 'Настройка поиска поддерживает несколько языков.'),
      chunk('zh', '安装文档说明如何配置搜索。'),
      chunk('en', 'Deploy the site to production.'),
    ]
    expect(rankLexicalChunks('configuración', chunks)[0]?.chunk.pageId).toBe('es')
    expect(rankLexicalChunks('поиска', chunks)[0]?.chunk.pageId).toBe('ru')
    expect(rankLexicalChunks('安装', chunks)[0]?.chunk.pageId).toBe('zh')
  })
})
