/**
 * The runtime content index must be authoritative when present and invisible
 * when absent. "Invisible" is the compatibility contract for every self-hosted
 * and pre-index managed site; "authoritative" is what keeps navigation,
 * enumeration, and staleness honest after a content publish that skipped a
 * build.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getContentIndex,
  isIndexedContentPath,
  resetContentIndexForTests,
} from '../content-index'
import {
  listRuntimeSources,
  runtimeSourceModifiedAt,
} from '../runtime-sources'

const VALID_INDEX = JSON.stringify({
  version: 1,
  pages: {
    'src/content/live-page.mdx': {
      data: { title: 'Live Page', description: 'Published without a build.' },
      modifiedAtMs: 1_753_000_000_000,
    },
    'snippets/shared.mdx': { data: {}, modifiedAtMs: 5 },
  },
})

describe('runtime content index', () => {
  beforeEach(() => {
    resetContentIndexForTests()
    vi.unstubAllEnvs()
    // The compiled fallback paths check NODE_ENV for dev filesystem reads;
    // production is the behaviour under test.
    vi.stubEnv('NODE_ENV', 'production')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    resetContentIndexForTests()
  })

  it('is null when the binding is absent, keeping compiled behaviour', () => {
    expect(getContentIndex()).toBeNull()
    // The compiled map still answers enumeration.
    expect(listRuntimeSources('src/content').length).toBeGreaterThan(0)
  })

  it('rejects malformed and wrong-version payloads without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (const raw of [
      '{not json',
      '[]',
      '"str"',
      JSON.stringify({ version: 2, pages: {} }),
      JSON.stringify({ version: 1 }),
      JSON.stringify({ version: 1, pages: { 'a.mdx': { data: [] } } }),
    ]) {
      resetContentIndexForTests()
      vi.stubEnv('THALLY_CONTENT_INDEX', raw)
      expect(getContentIndex()).toBeNull()
    }
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('is authoritative for content enumeration when present', () => {
    vi.stubEnv('THALLY_CONTENT_INDEX', VALID_INDEX)
    // Only the index's pages exist — compiled pages must not resurface. This
    // is the divergence case: content published without a rebuild.
    expect(listRuntimeSources('src/content')).toEqual([
      'src/content/live-page.mdx',
    ])
    expect(listRuntimeSources('snippets')).toEqual(['snippets/shared.mdx'])
  })

  it('leaves non-content prefixes on the compiled map', () => {
    expect(isIndexedContentPath('public/logo.svg')).toBe(false)
    // public/** enumeration must be identical with and without the index —
    // the index only speaks for src/content and snippets.
    const withoutIndex = listRuntimeSources('public')
    resetContentIndexForTests()
    vi.stubEnv('THALLY_CONTENT_INDEX', VALID_INDEX)
    expect(listRuntimeSources('public')).toEqual(withoutIndex)
  })

  it('supersedes compiled modification times for indexed paths', () => {
    vi.stubEnv('THALLY_CONTENT_INDEX', VALID_INDEX)
    expect(runtimeSourceModifiedAt('src/content/live-page.mdx')).toBe(
      1_753_000_000_000,
    )
    // Indexed root + missing from index ⇒ the page does not exist: zero, not
    // the compiled bundle's timestamp.
    expect(runtimeSourceModifiedAt('src/content/introduction.mdx')).toBe(0)
  })

  it('memoizes one parse per isolate', () => {
    vi.stubEnv('THALLY_CONTENT_INDEX', VALID_INDEX)
    const first = getContentIndex()
    vi.stubEnv('THALLY_CONTENT_INDEX', '{"version":1,"pages":{}}')
    expect(getContentIndex()).toBe(first)
  })
})
