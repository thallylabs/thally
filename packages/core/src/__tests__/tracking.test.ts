/** Contract tests for the shared Thally Track configuration shape. */

import { describe, expect, it } from 'vitest'
import {
  describeTrackedRepo,
  normalizeTrackedRepo,
  readTrackingConfig,
  trackedRepoEntry,
  trackedRepoKey,
  trackedRepoRef,
} from '../tracking.js'

describe('tracking config', () => {
  it('treats owner/repo-only entries as github.com on main', () => {
    expect(normalizeTrackedRepo({ owner: 'acme', repo: 'api' })).toMatchObject({
      provider: 'github',
      host: 'github.com',
      branch: 'main',
    })
  })

  it('defaults GitLab entries to gitlab.com and declared hosts to their provider', () => {
    expect(normalizeTrackedRepo({ owner: 'acme/platform', repo: 'api', provider: 'gitlab' }).host).toBe('gitlab.com')
    expect(
      normalizeTrackedRepo({ owner: 'acme', repo: 'api', host: 'git.example.com' }, [
        { host: 'git.example.com', provider: 'gitlab' },
      ]).provider,
    ).toBe('gitlab')
  })

  it('keys repositories by provider and host', () => {
    expect(trackedRepoKey({ owner: 'Acme', repo: 'API' })).toBe('github:github.com:acme/api')
    expect(trackedRepoKey({ owner: 'acme', repo: 'api', provider: 'gitlab' })).toBe('gitlab:gitlab.com:acme/api')
  })

  it('drops malformed entries when reading docs.json', () => {
    expect(
      readTrackingConfig({
        tracking: {
          repos: [
            { owner: 'acme', repo: 'api' },
            { owner: 'acme' },
            { owner: 'acme', repo: 'x', provider: 'svn' },
            { owner: 'acme', repo: 'y', host: 'https://bad' },
          ],
        },
      }).repos,
    ).toEqual([{ owner: 'acme', repo: 'api' }])
    expect(readTrackingConfig(null).repos).toEqual([])
  })

  it('builds references, descriptions, and minimal entries', () => {
    expect(trackedRepoRef({ owner: 'g/s', repo: 'p', provider: 'gitlab' })).toMatchObject({
      apiBaseUrl: 'https://gitlab.com/api/v4',
      fullPath: 'g/s/p',
    })
    expect(describeTrackedRepo({ owner: 'acme', repo: 'api' })).toBe('acme/api')
    expect(describeTrackedRepo({ owner: 'g', repo: 'p', provider: 'gitlab' })).toBe('gitlab:g/p')
    expect(describeTrackedRepo({ owner: 'g', repo: 'p', provider: 'gitlab', host: 'git.example.com' })).toBe(
      'git.example.com:g/p',
    )
    expect(trackedRepoEntry({ provider: 'github', host: 'github.com', owner: 'a', repo: 'b' })).toEqual({
      owner: 'a',
      repo: 'b',
    })
    expect(
      trackedRepoEntry({ provider: 'gitlab', host: 'git.example.com', owner: 'a', repo: 'b' }, { branch: 'dev' }),
    ).toEqual({ owner: 'a', repo: 'b', provider: 'gitlab', host: 'git.example.com', branch: 'dev' })
  })
})
