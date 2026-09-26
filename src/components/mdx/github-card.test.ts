/** Security and rendering coverage for network-free repository cards. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GitHub, GitHubCard, githubRepositoryHref } from '@/components/mdx/github-card'

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
