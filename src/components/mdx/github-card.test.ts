/** Security and rendering coverage for network-free repository cards. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GitHub, GitHubCard, GitLab, GitLabCard, githubRepositoryHref, gitlabRepositoryHref } from '@/components/mdx/github-card'

describe('GitHubCard', () => {
  it('renders a validated repository without remote metadata', () => {
    const html = renderToStaticMarkup(createElement(GitHubCard, { repo: 'thallylabs/thally' }))
    expect(html).toContain('href="https://github.com/thallylabs/thally"')
    expect(html).toContain('rel="noreferrer"')
  })

  it('exposes Repo as a static property so the Mintlify <GitHub.Repo> tag resolves', () => {
    expect(GitHub.Repo).toBe(GitHubCard)
    const html = renderToStaticMarkup(createElement(GitHub.Repo, { repo: 'thallylabs/thally' }))
    expect(html).toContain('href="https://github.com/thallylabs/thally"')
  })

  it.each([
    'https://github.com/owner/repo',
    'owner/repo/issues',
    '../repo',
    'owner/repo?tab=readme',
    'owner\\repo',
  ])('rejects unsafe or non-canonical repository input: %s', (repo) => {
    expect(githubRepositoryHref(repo)).toBeNull()
  })
})

describe('GitLabCard', () => {
  it('renders nested gitlab.com project paths', () => {
    const html = renderToStaticMarkup(createElement(GitLab.Repo, { repo: 'acme/platform/api', title: 'API' }))
    expect(GitLab.Repo).toBe(GitLabCard)
    expect(html).toContain('href="https://gitlab.com/acme/platform/api"')
    expect(html).toContain('API')
  })

  it.each(['acme', 'acme/../x', 'https://gitlab.com/a/b', 'a/b?x=1', 'a//b', 'a\\b'])('rejects %s', (repo) => {
    expect(gitlabRepositoryHref(repo)).toBeNull()
  })
})
