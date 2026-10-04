import { describe, expect, it } from 'vitest'
import { isChangelogPath, matchesSelectedTags, parseTagsParam, tagsByCount } from './update-filters'

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
    expect(parseTagsParam('?tags=Schemas,BYOK')).toEqual(['Schemas', 'BYOK'])
    expect(parseTagsParam('')).toEqual([])
  })

  it('swaps the table of contents for filters only on the changelog route', () => {
    expect(isChangelogPath('/docs/changelog')).toBe(true)
    expect(isChangelogPath('/changelog/')).toBe(true)
    expect(isChangelogPath('/docs/guides/changelog-tips')).toBe(false)
    expect(isChangelogPath(null)).toBe(false)
  })
})
