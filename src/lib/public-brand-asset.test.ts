/** Portable brand paths must remain inside the site's public directory. */

import { describe, expect, it } from 'vitest'
import { publicBrandAssetPath } from './public-brand-asset'

describe('publicBrandAssetPath', () => {
  it('accepts a migrated local asset', () => {
    expect(publicBrandAssetPath('/img/logo.svg')).toBe('/img/logo.svg')
    expect(publicBrandAssetPath('public/img/favicon.ico')).toBe('/img/favicon.ico')
  })

  it.each([
    'https://other.example/logo.svg',
    '//other.example/logo.svg',
    '/%2e%2e/private.svg',
    '/img/%2e%2e/private.svg',
    '/img%2f..%2fprivate.svg',
    '/img/%252e%252e/private.svg',
    '/img/logo.svg?next=//other.example',
    '/img\\logo.svg',
    '%00/logo.svg',
  ])('rejects unsafe asset reference %s', (value) => {
    expect(publicBrandAssetPath(value)).toBeNull()
  })
})
