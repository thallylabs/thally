import { describe, expect, it } from 'vitest'
import { isChangelogPath, matchesSelectedTags, parseTagsParam, shouldRevealForHash, tagsByCount, validSelectedTags } from './update-filters'

describe('update tag filters', () => {
  it('shows every entry when nothing is selected', () => {
    expect(matchesSelectedTags([], [])).toBe(true)
    expect(matchesSelectedTags(['A'], [])).toBe(true)
  })

  it('matches entries with any selected tag and hides the rest, including untagged entries', () => {
    expect(matchesSelectedTags(['A', 'B'], ['B', 'C'])).toBe(true)
    expect(matchesSelectedTags(['A'], ['B'])).toBe(false)
    expect(matchesSelectedTags([], ['B'])).toBe(false)
  })

  it('orders tags by usage with a stable tie-break', () => {
    expect(tagsByCount({ A: 1, B: 3, C: 1, D: 0 })).toEqual(['B', 'A', 'C'])
  })

  it('parses the tags URL parameter', () => {
    // legacy comma form yields the whole value plus its parts; unmatched candidates are dropped by validSelectedTags
    expect(parseTagsParam('?tags=Schemas,BYOK')).toEqual(['Schemas,BYOK', 'Schemas', 'BYOK'])
    expect(parseTagsParam('')).toEqual([])
    expect(parseTagsParam('?tags=Schemas&tags=BYOK')).toEqual(['Schemas', 'BYOK'])
    // a tag containing a comma survives the repeated-param round trip
    const url = new URL('https://x.test/c')
    for (const tag of ['Models, pricing', 'BYOK']) url.searchParams.append('tags', tag)
    expect(parseTagsParam(url.search, { 'Models, pricing': 1, BYOK: 1 })).toEqual(['Models, pricing', 'BYOK'])
  })

  it('prefers an exact registered tag over the legacy comma split', () => {
    const search = new URL('https://x.test/c?' + new URLSearchParams([['tags', 'Models, pricing']])).search
    // both the comma tag and its parts exist: only the exact tag is restored
    expect(parseTagsParam(search, { 'Models, pricing': 1, Models: 2, pricing: 1 })).toEqual(['Models, pricing'])
    // no exact tag registered: fall back to the legacy split
    expect(parseTagsParam(search, { Models: 2, pricing: 1 })).toEqual(['Models', 'pricing'])
    expect(parseTagsParam('?tags=Schemas,BYOK', { Schemas: 1, BYOK: 1 })).toEqual(['Schemas', 'BYOK'])
  })

  it('swaps the table of contents for filters only on the changelog route', () => {
    expect(isChangelogPath('/docs/changelog')).toBe(true)
    expect(isChangelogPath('/changelog/')).toBe(true)
    expect(isChangelogPath('/docs/guides/changelog-tips')).toBe(false)
    expect(isChangelogPath(null)).toBe(false)
  })

  it('ignores stale selected tags so nothing is hidden when none are valid', () => {
    const counts = { A: 2, B: 0 }
    expect(validSelectedTags(['gone'], counts)).toEqual([])
    expect(validSelectedTags(['gone', 'A', 'B'], counts)).toEqual(['A'])
    expect(matchesSelectedTags([], validSelectedTags(['gone'], counts))).toBe(true)
    expect(matchesSelectedTags([], validSelectedTags(['A'], counts))).toBe(false)
  })

  it('reveals only a hidden entry targeted by the hash', () => {
    expect(shouldRevealForHash('#may-2025', 'may-2025', true)).toBe(true)
    expect(shouldRevealForHash('#may-2025', 'may-2025', false)).toBe(false)
    expect(shouldRevealForHash('#other', 'may-2025', true)).toBe(false)
    expect(shouldRevealForHash('#caf%C3%A9', 'café', true)).toBe(true)
    expect(shouldRevealForHash('#%E0%A4', '%E0%A4', true)).toBe(true)
    expect(shouldRevealForHash('', undefined, true)).toBe(false)
  })
})
