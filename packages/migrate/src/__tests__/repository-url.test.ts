/** Repository URL parsing and routing for GitHub, GitLab, and declared self-hosted hosts. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseRepositoryReference } from '@thallylabs/core/repository'

import { isRepositoryUrl, parseGitHubRepositoryUrl, parseRepositoryUrl } from '../repository.js'
import { parseSourceRefFlags, sourceRefOversizeReason, SOURCE_REF_MAX_REPOSITORY_KB } from '../source-refs.js'
import type { MigrationFetcher } from '../types.js'

let savedHosts: string | undefined
beforeEach(() => {
  savedHosts = process.env.THALLY_GIT_HOSTS
  delete process.env.THALLY_GIT_HOSTS
})
afterEach(() => {
  if (savedHosts === undefined) delete process.env.THALLY_GIT_HOSTS
  else process.env.THALLY_GIT_HOSTS = savedHosts
})

describe('parseRepositoryUrl', () => {
  it('keeps the GitHub contract, including the deprecated alias', () => {
    const expected = {
      owner: 'acme',
      repo: 'docs',
      branch: 'main',
      docsDir: 'content/guides',
      cloneUrl: 'https://github.com/acme/docs.git',
      provider: 'github',
      host: 'github.com',
      fullPath: 'acme/docs',
    }
    expect(parseRepositoryUrl('https://github.com/acme/docs/tree/main/content/guides')).toEqual(expected)
    expect(parseGitHubRepositoryUrl('https://github.com/acme/docs/tree/main/content/guides')).toEqual(expected)
    expect(parseRepositoryUrl('https://github.com/acme/docs.git')).toMatchObject({ branch: 'HEAD', docsDir: '' })
  })

  it('parses GitLab projects with nested groups and /-/tree paths', () => {
    expect(parseRepositoryUrl('https://gitlab.com/acme/platform/docs/-/tree/develop/site')).toEqual({
      owner: 'acme/platform',
      repo: 'docs',
      branch: 'develop',
      docsDir: 'site',
      cloneUrl: 'https://gitlab.com/acme/platform/docs.git',
      provider: 'gitlab',
      host: 'gitlab.com',
      fullPath: 'acme/platform/docs',
    })
    expect(parseRepositoryUrl('https://gitlab.com/acme/docs')).toMatchObject({ branch: 'HEAD', docsDir: '' })
  })

  it('accepts self-hosted hosts only when declared', () => {
    expect(() => parseRepositoryUrl('https://git.example.com/team/docs')).toThrow(/THALLY_GIT_HOSTS/)
    process.env.THALLY_GIT_HOSTS = 'git.example.com=gitlab'
    expect(parseRepositoryUrl('https://git.example.com/team/docs').cloneUrl).toBe('https://git.example.com/team/docs.git')
    expect(isRepositoryUrl('https://git.example.com/team/docs')).toBe(true)
  })

  it.each([
    ['http://github.com/acme/docs', /https URL/],
    ['https://user:token@gitlab.com/acme/docs', /credentials/],
    ['https://gitlab.com:8443/acme/docs', /credentials or custom ports/],
    ['https://gitlab.com/acme', /owner \(or group\)/],
    ['https://github.com.evil.test/acme/docs', /https URL/],
    ['not a url', /Invalid repository URL/],
  ])('rejects %s', (input, message) => {
    expect(() => parseRepositoryUrl(input)).toThrow(message)
  })

  it('routes only recognised hosts to repository cloning', () => {
    expect(isRepositoryUrl('https://github.com/acme/docs')).toBe(true)
    expect(isRepositoryUrl('https://gitlab.com/acme/docs')).toBe(true)
    expect(isRepositoryUrl('https://docs.acme.com/guide')).toBe(false)
    expect(isRepositoryUrl('nope')).toBe(false)
  })
})

describe('GitLab sourceRef mappings', () => {
  const fetcher = (body: string, calls: Array<string>): MigrationFetcher => async (url) => {
    calls.push(String(url))
    return { finalUrl: url, body, contentType: 'application/json' }
  }

  it('accepts a repository URL on the left of the mount path', () => {
    const [mapping] = parseSourceRefFlags(['https://gitlab.com/acme/sdks/ts=client-sdks/typescript'])
    expect(mapping).toMatchObject({ repo: 'acme/sdks/ts', mountPath: 'client-sdks/typescript' })
    expect(mapping.repository).toMatchObject({ provider: 'gitlab', fullPath: 'acme/sdks/ts' })
    expect(() => parseSourceRefFlags(['https://gitlab.com/acme/sdks/ts/-/merge_requests/1=x'])).toThrow(/must name a repository/)
    expect(() => parseSourceRefFlags(['https://evil.test/a/b=x'])).toThrow(/must name a repository/)
  })

  it('checks GitLab repository size in bytes', async () => {
    const ref = parseRepositoryReference('https://gitlab.com/acme/sdks/ts')!
    const calls: Array<string> = []
    const over = JSON.stringify({ statistics: { repository_size: (SOURCE_REF_MAX_REPOSITORY_KB + 1) * 1024 } })
    expect(await sourceRefOversizeReason(ref, fetcher(over, calls))).toMatch(/GitLab reports .* 200 MB limit/)
    expect(calls[0]).toBe('https://gitlab.com/api/v4/projects/acme%2Fsdks%2Fts?statistics=true')
    expect(await sourceRefOversizeReason(ref, fetcher(JSON.stringify({ statistics: { repository_size: 1024 } }), []))).toBeNull()
    expect(await sourceRefOversizeReason(ref, fetcher('{}', []))).toBeNull()
  })
})
