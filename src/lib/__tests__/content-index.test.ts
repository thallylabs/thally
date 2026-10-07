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

describe('ASSETS content index loading', () => {
  afterEach(async () => {
    const { setContentAssetFetcher } = await import('@/lib/content-source/runtime')
    setContentAssetFetcher(null)
    resetContentIndexForTests()
    vi.useRealTimers()
  })

  it('does not cache a failed or non-OK load for the isolate; it retries after a bounded backoff', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-07T00:00:00Z'))
    const { setContentAssetFetcher } = await import('@/lib/content-source/runtime')
    const { loadContentIndex } = await import('../content-index')
    const responses = [new Response('nope', { status: 503 }), new Response(VALID_INDEX)]
    const fetcher = vi.fn(async () => responses.shift() ?? new Response('gone', { status: 500 }))
    setContentAssetFetcher(fetcher)

    expect(await loadContentIndex()).toBeNull()
    // Inside the backoff window no new fetch is made.
    expect(await loadContentIndex()).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-10-07T00:00:06Z'))
    const loaded = await loadContentIndex()
    expect(loaded?.pages['src/content/live-page.mdx']).toBeDefined()
    expect(fetcher).toHaveBeenCalledTimes(2)
    // A successful load is then kept.
    await loadContentIndex()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('backs off exponentially while the index keeps failing, capped', async () => {
    vi.useFakeTimers()
    let now = Date.parse('2026-10-07T00:00:00Z')
    vi.setSystemTime(now)
    const { setContentAssetFetcher } = await import('@/lib/content-source/runtime')
    const { loadContentIndex } = await import('../content-index')
    const fetcher = vi.fn(async () => new Response('not json', { status: 200 }))
    setContentAssetFetcher(fetcher)
    for (const waitMs of [5_000, 10_000, 20_000]) {
      await loadContentIndex()
      now += waitMs - 1
      vi.setSystemTime(now)
      await loadContentIndex()
      now += 1
      vi.setSystemTime(now)
    }
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
