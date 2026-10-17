/** The navbar star count costs one API request per session and fails quietly, on GitHub or GitLab. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseRepositoryReference } from '@thallylabs/core/repository'

const store = new Map<string, string>()

describe('fetchRepositoryStars', () => {
  beforeEach(() => {
    vi.resetModules()
    store.clear()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    })
  })

  it('fetches once for concurrent and repeat calls (deprecated GitHub helper)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ stargazers_count: 42 }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchGithubStars } = await import('./github-stars')

    expect(await Promise.all([fetchGithubStars('a/b'), fetchGithubStars('a/b')])).toEqual([42, 42])
    vi.resetModules()
    expect(await (await import('./github-stars')).fetchGithubStars('a/b')).toBe(42)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/repos/a/b')
    expect(store.has('thally:github-stars:a/b')).toBe(true)
  })

  it('reads GitLab star_count from the encoded project endpoint', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ star_count: 7 }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchRepositoryStars } = await import('./repository-stars')
    expect(await fetchRepositoryStars(parseRepositoryReference('https://gitlab.com/g/s/p')!)).toBe(7)
    expect(fetchMock).toHaveBeenCalledWith('https://gitlab.com/api/v4/projects/g%2Fs%2Fp')
    expect(store.has('thally:repo-stars:gitlab.com/g/s/p')).toBe(true)
  })

  it('returns null on a rate-limit response or network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    expect(await (await import('./github-stars')).fetchGithubStars('a/b')).toBeNull()
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await (await import('./github-stars')).fetchGithubStars('a/b')).toBeNull()
  })
})
