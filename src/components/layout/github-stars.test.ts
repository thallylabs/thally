/** The navbar star count costs one GitHub request per session and fails quietly. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()

describe('fetchGithubStars', () => {
  beforeEach(() => {
    vi.resetModules()
    store.clear()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    })
  })

  it('fetches once for concurrent and repeat calls', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ stargazers_count: 42 }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchGithubStars } = await import('./github-stars')

    expect(await Promise.all([fetchGithubStars('a/b'), fetchGithubStars('a/b')])).toEqual([42, 42])
    vi.resetModules()
    expect(await (await import('./github-stars')).fetchGithubStars('a/b')).toBe(42)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns null on a rate-limit response or network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    expect(await (await import('./github-stars')).fetchGithubStars('a/b')).toBeNull()
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await (await import('./github-stars')).fetchGithubStars('a/b')).toBeNull()
  })
})
