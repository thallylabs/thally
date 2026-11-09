/** The built-in English changelog description belongs to the default locale only. */

import { describe, expect, it } from 'vitest'

import { changelogIndexDescription } from '../repository.js'

describe('changelogIndexDescription', () => {
  it('is the English line for a page with no locale or the default locale', () => {
    expect(changelogIndexDescription(undefined, 'en')).toBe('Latest release notes and product updates.')
    expect(changelogIndexDescription('en', 'en')).toBe('Latest release notes and product updates.')
    expect(changelogIndexDescription(undefined, undefined)).toBe('Latest release notes and product updates.')
  })

  it('is empty for any other locale', () => {
    expect(changelogIndexDescription('fr', 'en')).toBe('')
    expect(changelogIndexDescription('fr', undefined)).toBe('')
  })
})
