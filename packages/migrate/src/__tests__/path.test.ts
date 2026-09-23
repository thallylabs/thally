/** Regression coverage for migration path normalization boundaries. */

import { describe, expect, it } from 'vitest'

import { pageIdFromReference, trimEdgeSlashes, trimTrailingSlashes } from '../path.js'

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

describe('pageIdFromReference readme/index handling', () => {
  it('collapses a root-level readme to the content root', () => {
    expect(pageIdFromReference('readme.md')).toBe('introduction')
  })

  it('collapses an index page to its parent directory at any depth', () => {
    expect(pageIdFromReference('migration/index.mdx')).toBe('migration')
  })

  it('keeps a nested readme as its own page instead of colliding with index', () => {
    expect(pageIdFromReference('migration/readme.mdx')).toBe('migration/readme')
  })
})
