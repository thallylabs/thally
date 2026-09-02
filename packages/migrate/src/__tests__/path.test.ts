/** Regression coverage for migration path normalization boundaries. */

import { describe, expect, it } from 'vitest'

import { trimEdgeSlashes, trimTrailingSlashes } from '../path.js'

describe('migration path normalization', () => {
  it('trims slash runs without changing the absolute-path boundary', () => {
    expect(trimTrailingSlashes('/absolute/path////')).toBe('/absolute/path')
    expect(trimEdgeSlashes('////docs/reference////')).toBe('docs/reference')
  })

  it('handles long slash runs in linear time', () => {
    const slashes = '/'.repeat(100_000)
    expect(trimTrailingSlashes(`docs${slashes}`)).toBe('docs')
    expect(trimEdgeSlashes(`${slashes}docs${slashes}`)).toBe('docs')
  })
})
