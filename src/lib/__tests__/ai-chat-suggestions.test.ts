/** Coverage for context-derived assistant suggestions and the follow-up header contract. */

import { describe, expect, it } from 'vitest'
import {
  deriveFollowUpSuggestions,
  deriveStarterSuggestions,
  normalizeAiSuggestions,
  parseAiFollowUps,
  questionForPageTitle,
  serializeAiFollowUps,
} from '@/lib/ai-chat-suggestions'

const page = (title: string, href = `/${title.toLowerCase().replace(/\W+/g, '-')}`) => ({ title, href })

describe('assistant suggestions', () => {
  it('phrases page titles as reader questions', () => {
    expect(questionForPageTitle('Add an API reference')).toBe('How do I add an API reference?')
    expect(questionForPageTitle('Specdiff')).toBe('What is Specdiff?')
    expect(questionForPageTitle('Webhooks')).toBe('How do webhooks work?')
    expect(questionForPageTitle('Access')).toBe('What is Access?')
    expect(questionForPageTitle('Writing content')).toBe('What should I know about writing content?')
    expect(questionForPageTitle('API keys')).toBe('What should I know about API keys?')
    expect(questionForPageTitle('How billing works')).toBe('How billing works?')
    expect(questionForPageTitle('Can I self-host?')).toBe('Can I self-host?')
    expect(questionForPageTitle('  ')).toBe('')
  })

  it('derives opening questions from the site navigation, not a fixed list', () => {
    const suggestions = deriveStarterSuggestions({
      siteName: 'Seemline',
      collections: [
        { label: 'Get Started', sections: [{ items: [page('Seamline Toolkit', '/'), page('Quickstart')] }] },
        { label: 'Specdiff', sections: [{ items: [page('Overview', '/specdiff'), page('Rule codes')] }] },
        { label: 'Envlock', sections: [{ items: [page('Overview', '/envlock')] }] },
        { label: 'Changelog', sections: [{ items: [page('Changelog')] }] },
      ],
    })
    expect(suggestions).toEqual([
      'How do I get started with Seemline?',
      // Product names keep their casing; a product-area tab is its own subject.
      'What should I know about Seamline Toolkit?',
      'What is Specdiff?',
    ])
    expect(suggestions.join(' ')).not.toMatch(/navigation|API reference|Changelog/i)
  })

  it('names a collection when its only page has a generic title', () => {
    expect(deriveStarterSuggestions({
      collections: [{ label: 'Envlock', sections: [{ items: [page('Overview', '/envlock')] }] }],
    })).toEqual(['How do I get started?', 'What is Envlock?'])
  })

  it('returns nothing for a site without navigable pages', () => {
    expect(deriveStarterSuggestions({ collections: [] })).toEqual([])
  })

  it('derives follow-ups from retrieved pages the reader has not asked about', () => {
    const followUps = deriveFollowUpSuggestions({
      sources: [
        { title: 'Navigation', url: '/guides/navigation' },
        { title: 'Tabs and groups', url: '/guides/tabs' },
        { title: 'Configure redirects', url: '/guides/redirects' },
        { title: 'Changelog', url: '/changelog' },
      ],
      asked: ['How does navigation work?'],
    })
    expect(followUps).toEqual([
      'What should I know about Tabs and groups?',
      'How do I configure redirects?',
    ])
  })

  it('bounds, deduplicates, and sanitizes untrusted suggestion lists', () => {
    expect(normalizeAiSuggestions([
      ' How do  tabs work? ', 'how do tabs work?', 'Line\nbreak?', 42, 'x'.repeat(121), 'Third?', 'Fourth?',
    ])).toEqual(['How do tabs work?', 'Line break?', 'Third?'])
    expect(normalizeAiSuggestions('nope')).toEqual([])
  })

  it('round-trips follow-ups through the response header and rejects malformed values', () => {
    const header = serializeAiFollowUps(['What about “smart quotes”?', 'Second?'])
    expect(header).toMatch(/^[\x20-\x7e]+$/)
    expect(parseAiFollowUps(header)).toEqual(['What about “smart quotes”?', 'Second?'])
    expect(parseAiFollowUps('%E0%A4%A')).toEqual([])
    expect(parseAiFollowUps(null)).toEqual([])
    expect(serializeAiFollowUps([])).toBe('')
  })
})
