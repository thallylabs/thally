/** Contract tests for repository parsing and provider-aware URL builders. */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GIT_HOSTS,
  isPlaceholderRepositoryUrl,
  isRepositoryLinkType,
  parseGitHostsEnv,
  parseRepositoryReference,
  providerLabel,
  pullRequestLabel,
  readGitHostsConfig,
  repositoryApiProjectUrl,
  repositoryCloneUrl,
  repositoryEditFileUrl,
  repositoryNewIssueUrl,
  repositoryPullRequestUrl,
  repositoryRawFileUrl,
  repositoryTreeUrl,
  repositoryWebUrl,
  resolveGitHosts,
  starCountFromApiPayload,
} from '../index.js'

const selfHosted = resolveGitHosts([{ host: 'git.example.com', provider: 'gitlab' }])

describe('parseRepositoryReference', () => {
  it.each([
    ['acme/widgets', 'github', 'github.com', 'acme', 'widgets'],
    ['https://github.com/acme/widgets', 'github', 'github.com', 'acme', 'widgets'],
    ['https://github.com/acme/widgets.git', 'github', 'github.com', 'acme', 'widgets'],
    ['https://www.github.com/acme/widgets/', 'github', 'github.com', 'acme', 'widgets'],
    ['github.com/acme/widgets', 'github', 'github.com', 'acme', 'widgets'],
    ['git@github.com:acme/widgets.git', 'github', 'github.com', 'acme', 'widgets'],
    ['ssh://git@github.com/acme/widgets.git', 'github', 'github.com', 'acme', 'widgets'],
    ['https://gitlab.com/acme/widgets', 'gitlab', 'gitlab.com', 'acme', 'widgets'],
    ['https://gitlab.com/acme/platform/widgets', 'gitlab', 'gitlab.com', 'acme/platform', 'widgets'],
    ['acme/platform/widgets', 'gitlab', 'gitlab.com', 'acme/platform', 'widgets'],
    ['git@gitlab.com:acme/platform/widgets.git', 'gitlab', 'gitlab.com', 'acme/platform', 'widgets'],
    ['ssh://git@gitlab.com:2222/acme/widgets.git', 'gitlab', 'gitlab.com', 'acme', 'widgets'],
  ])('parses %s', (input, provider, host, owner, repo) => {
    const ref = parseRepositoryReference(input)
    expect(ref).toMatchObject({ provider, host, owner, repo, fullPath: `${owner}/${repo}` })
  })

  it('keeps a bare two-segment spec on github.com', () => {
    expect(parseRepositoryReference('acme/api')?.host).toBe('github.com')
    expect(parseRepositoryReference('acme/api', { provider: 'gitlab' })?.host).toBe('gitlab.com')
  })

  it('reads branch and directory from tree URLs', () => {
    expect(parseRepositoryReference('https://github.com/acme/docs/tree/main/docs/guides')).toMatchObject({
      ref: 'main',
      path: 'docs/guides',
    })
    expect(parseRepositoryReference('https://gitlab.com/acme/sub/docs/-/tree/develop/content')).toMatchObject({
      owner: 'acme/sub',
      repo: 'docs',
      ref: 'develop',
      path: 'content',
    })
    expect(parseRepositoryReference('https://gitlab.com/acme/sub/docs/tree/develop')).toMatchObject({
      owner: 'acme/sub',
      ref: 'develop',
    })
  })

  it('reads pull and merge request numbers', () => {
    expect(parseRepositoryReference('https://github.com/a/b/pull/42')?.number).toBe(42)
    expect(parseRepositoryReference('a/b#7')?.number).toBe(7)
    expect(parseRepositoryReference('https://gitlab.com/g/s/p/-/merge_requests/9')).toMatchObject({
      owner: 'g/s',
      repo: 'p',
      number: 9,
    })
    expect(parseRepositoryReference('g/s/p!3')?.number).toBe(3)
    expect(parseRepositoryReference('a/b!3')).toBeNull()
  })

  it('recognises declared self-hosted hosts only', () => {
    expect(parseRepositoryReference('https://git.example.com/team/app')).toBeNull()
    expect(parseRepositoryReference('https://git.example.com/team/app', { hosts: selfHosted })).toMatchObject({
      provider: 'gitlab',
      host: 'git.example.com',
      apiBaseUrl: 'https://git.example.com/api/v4',
    })
    expect(parseRepositoryReference('team/app', { hosts: selfHosted, host: 'git.example.com' })).toMatchObject({
      provider: 'gitlab',
      host: 'git.example.com',
    })
  })

  it('keeps the whole path for unknown hosts with a fallback provider', () => {
    expect(
      parseRepositoryReference('https://code.corp.test/org/team/docs/', { fallbackProvider: 'github' }),
    ).toMatchObject({ provider: 'github', origin: 'https://code.corp.test', fullPath: 'org/team/docs' })
  })

  it.each([
    '',
    'acme',
    'https://user:token@github.com/acme/widgets',
    'https://github.com:8443/acme/widgets',
    'https://github.com/acme',
    'https://github.com.evil.test/acme/widgets',
    'https://evil.test/github.com/acme/widgets',
    'file:///etc/passwd',
    'acme/../widgets',
    'acme widgets/x',
  ])('rejects %s', (input) => {
    expect(parseRepositoryReference(input)).toBeNull()
  })
})

describe('URL builders', () => {
  const github = parseRepositoryReference('https://github.com/acme/docs')!
  const gitlab = parseRepositoryReference('https://gitlab.com/acme/platform/docs')!

  it('builds GitHub URLs in the historical format', () => {
    expect(repositoryWebUrl(github)).toBe('https://github.com/acme/docs')
    expect(repositoryEditFileUrl(github, 'main', 'src/content/intro.mdx')).toBe(
      'https://github.com/acme/docs/edit/main/src/content/intro.mdx',
    )
    expect(repositoryNewIssueUrl(github, { title: 'Docs feedback: /intro' })).toBe(
      `https://github.com/acme/docs/issues/new?title=${encodeURIComponent('Docs feedback: /intro')}`,
    )
    expect(repositoryPullRequestUrl(github, 4)).toBe('https://github.com/acme/docs/pull/4')
    expect(repositoryTreeUrl(github, 'main', 'docs')).toBe('https://github.com/acme/docs/tree/main/docs')
    expect(repositoryRawFileUrl(github, 'main', 'docs.json')).toBe(
      'https://raw.githubusercontent.com/acme/docs/main/docs.json',
    )
    expect(repositoryCloneUrl(github)).toBe('https://github.com/acme/docs.git')
    expect(repositoryApiProjectUrl(github)).toBe('https://api.github.com/repos/acme/docs')
  })

  it('builds GitLab URLs with the /-/ prefix and encoded project ids', () => {
    expect(repositoryEditFileUrl(gitlab, 'main', 'docs.json')).toBe(
      'https://gitlab.com/acme/platform/docs/-/edit/main/docs.json',
    )
    expect(repositoryNewIssueUrl(gitlab, { title: 'Bug', body: 'a b' })).toBe(
      'https://gitlab.com/acme/platform/docs/-/issues/new?issue%5Btitle%5D=Bug&issue%5Bdescription%5D=a%20b',
    )
    expect(repositoryPullRequestUrl(gitlab, 4)).toBe('https://gitlab.com/acme/platform/docs/-/merge_requests/4')
    expect(repositoryTreeUrl(gitlab, 'main')).toBe('https://gitlab.com/acme/platform/docs/-/tree/main')
    expect(repositoryRawFileUrl(gitlab, 'main', 'a/b.md')).toBe(
      'https://gitlab.com/acme/platform/docs/-/raw/main/a/b.md',
    )
    expect(repositoryCloneUrl(gitlab, 'ssh')).toBe('git@gitlab.com:acme/platform/docs.git')
    expect(repositoryApiProjectUrl(gitlab)).toBe('https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fdocs')
  })

  it('reads stars from either provider payload', () => {
    expect(starCountFromApiPayload({ stargazers_count: 5 })).toBe(5)
    expect(starCountFromApiPayload({ star_count: 7 })).toBe(7)
    expect(starCountFromApiPayload({ message: 'rate limited' })).toBeNull()
    expect(starCountFromApiPayload(null)).toBeNull()
  })

  it('labels providers and requests', () => {
    expect(providerLabel('gitlab')).toBe('GitLab')
    expect(pullRequestLabel('github', 4)).toBe('#4')
    expect(pullRequestLabel('gitlab', 4)).toBe('!4')
    expect(isRepositoryLinkType('gitlab')).toBe(true)
    expect(isRepositoryLinkType('twitter')).toBe(false)
    expect(isPlaceholderRepositoryUrl('https://github.com/your-org/docs')).toBe(true)
    expect(isPlaceholderRepositoryUrl('')).toBe(true)
    expect(isPlaceholderRepositoryUrl('https://gitlab.com/acme/docs')).toBe(false)
  })
})

describe('host configuration', () => {
  it('parses env declarations and skips junk', () => {
    expect(parseGitHostsEnv('Git.Example.com=gitlab, ghe.corp=github bad nope=svn x=gitlab=1')).toEqual([
      { host: 'git.example.com', provider: 'gitlab' },
      { host: 'ghe.corp', provider: 'github' },
    ])
    expect(parseGitHostsEnv(undefined)).toEqual([])
  })

  it('reads docs.json declarations', () => {
    expect(
      readGitHostsConfig({
        repository: {
          hosts: [
            { host: 'git.example.com', provider: 'gitlab' },
            { host: 'https://bad', provider: 'gitlab' },
            { host: 'x.test', provider: 'svn' },
          ],
        },
      }),
    ).toEqual([{ host: 'git.example.com', provider: 'gitlab' }])
    expect(readGitHostsConfig({})).toEqual([])
  })

  it('keeps defaults and lets declarations override', () => {
    expect(resolveGitHosts()).toBe(DEFAULT_GIT_HOSTS)
    const hosts = resolveGitHosts([{ host: 'ghe.corp', provider: 'github' }])
    expect(hosts.find((host) => host.host === 'ghe.corp')?.apiBaseUrl).toBe('https://ghe.corp/api/v3')
    expect(hosts.find((host) => host.host === 'github.com')).toBeDefined()
  })
})
