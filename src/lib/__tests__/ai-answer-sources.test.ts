/** AI answer source response-header contract coverage. */

import { describe, expect, it } from 'vitest'

import {
  parseAiAnswerSources,
  serializeAiAnswerSources,
} from '@/lib/ai-answer-sources'

describe('AI answer sources', () => {
  it('round-trips distinct internal documentation pages', () => {
    const header = serializeAiAnswerSources([
      { title: 'Quickstart', url: '/quickstart#install' },
      { title: 'Quickstart duplicate', url: '/quickstart#configure' },
      { title: 'API reference', url: '/api/reference' },
    ])

    expect(parseAiAnswerSources(header)).toEqual([
      { title: 'Quickstart', url: '/quickstart#install' },
      { title: 'API reference', url: '/api/reference' },
    ])
  })

  it('rejects external, protocol-relative, malformed, and oversized metadata', () => {
    const header = encodeURIComponent(
      JSON.stringify([
        { title: 'External', url: 'https://example.com/phishing' },
        { title: 'Protocol relative', url: '//example.com/phishing' },
        { title: 'Backslash', url: '/\\example.com/phishing' },
        { title: 'Oversized', url: `/${'x'.repeat(513)}` },
        { title: 'Safe', url: '/guides/safe' },
      ]),
    )

    expect(parseAiAnswerSources(header)).toEqual([
      { title: 'Safe', url: '/guides/safe' },
    ])
    expect(parseAiAnswerSources('%E0%A4%A')).toEqual([])
  })

  it('caps the disclosure to eight pages', () => {
    const sources = Array.from({ length: 12 }, (_, index) => ({
      title: `Page ${index + 1}`,
      url: `/page-${index + 1}`,
    }))

    expect(parseAiAnswerSources(serializeAiAnswerSources(sources))).toHaveLength(8)
  })
})
