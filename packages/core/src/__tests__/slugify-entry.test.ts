/** Verify the narrow package entry preserves the public barrel's slug contract. */

import { describe, expect, it } from 'vitest'
import { slugify as fromCore } from '@thallylabs/core'
import { slugify as fromSubpath } from '@thallylabs/core/slugify'

describe('@thallylabs/core/slugify', () => {
  it.each([
    ['Getting Started', 'getting-started'],
    ['  Ada Lovelace  ', 'ada-lovelace'],
    ['Équipe / API', 'quipe-api'],
    ['---', ''],
  ])('matches the root export for %s', (input, expected) => {
    expect(fromSubpath(input)).toBe(expected)
    expect(fromSubpath(input)).toBe(fromCore(input))
  })
})
