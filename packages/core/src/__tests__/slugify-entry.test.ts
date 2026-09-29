/** Verify the narrow package entry preserves the public barrel's slug contract. */

import { describe, expect, it } from 'vitest'
import { slugify as fromCore } from '@thallylabs/core'
import { slugify as fromSubpath } from '@thallylabs/core/slugify'

describe('@thallylabs/core/slugify', () => {
  it.each([
    ['Getting Started', 'getting-started'],
    ['  Ada Lovelace  ', 'ada-lovelace'],
    ['Équipe / API', 'équipe-api'],
    ['Überblick und Größe', 'überblick-und-größe'],
    ['日本語 API', '日本語-api'],
    ['Cafe\u0301', 'café'],
    ['---', ''],
  ])('matches the root export for %s', (input, expected) => {
    expect(fromSubpath(input)).toBe(expected)
    expect(fromSubpath(input)).toBe(fromCore(input))
  })
})
