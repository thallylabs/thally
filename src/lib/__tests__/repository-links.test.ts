/** Reader-facing repository links: GitHub output stays byte-identical; GitLab gains /-/ routes. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { repositoryEditFileUrl, repositoryNewIssueUrl } from '@thallylabs/core/repository'
import { resolveRepository } from '@/lib/repository-links'
import { buildCodeReportUrl } from '@/lib/code-actions'
import { EditOnRepository } from '@/components/docs/edit-on-github'
import { ReportAnIssue } from '@/components/docs/report-an-issue'

const selfHosted = [{ host: 'git.example.com', provider: 'gitlab' as const }]

describe('resolveRepository', () => {
  it.each([
    ['https://github.com/acme/docs', 'https://github.com/acme/docs/edit/main/x.mdx', 'https://github.com/acme/docs/issues/new?title=T'],
    ['https://github.com/acme/docs/', 'https://github.com/acme/docs/edit/main/x.mdx', 'https://github.com/acme/docs/issues/new?title=T'],
    ['https://code.corp.test/team/docs', 'https://code.corp.test/team/docs/edit/main/x.mdx', 'https://code.corp.test/team/docs/issues/new?title=T'],
    ['https://example.com/docs', 'https://example.com/docs/edit/main/x.mdx', 'https://example.com/docs/issues/new?title=T'],
    ['https://gitlab.com/acme/platform/docs', 'https://gitlab.com/acme/platform/docs/-/edit/main/x.mdx', 'https://gitlab.com/acme/platform/docs/-/issues/new?issue%5Btitle%5D=T'],
  ])('builds links for %s', (repoUrl, edit, issue) => {
    const repository = resolveRepository(repoUrl)!
    expect(repositoryEditFileUrl(repository, 'main', 'x.mdx')).toBe(edit)
    expect(repositoryNewIssueUrl(repository, { title: 'T' })).toBe(issue)
  })

  it('uses declared hosts for self-hosted GitLab', () => {
    expect(resolveRepository('https://git.example.com/team/docs')?.provider).toBe('github')
    expect(resolveRepository('https://git.example.com/team/docs', selfHosted)?.provider).toBe('gitlab')
  })

  it.each(['', 'https://github.com/your-org/docs', 'javascript:alert(1)', 'ftp://example.com/a/b', 'not a url'])(
    'returns null for %s',
    (repoUrl) => {
      expect(resolveRepository(repoUrl)).toBeNull()
    },
  )
})

describe('repository link components', () => {
  it('renders GitLab edit and issue links', () => {
    const edit = renderToStaticMarkup(createElement(EditOnRepository, {
      pageId: 'guides/start',
      repoUrl: 'https://git.example.com/team/docs',
      gitHosts: selfHosted,
    }))
    expect(edit).toContain('href="https://git.example.com/team/docs/-/edit/main/src/content/guides/start.mdx"')
    expect(edit).toContain('Edit this page on GitLab')

    const issue = renderToStaticMarkup(createElement(ReportAnIssue, {
      pagePath: '/guides/start',
      repoUrl: 'https://gitlab.com/acme/docs',
    }))
    expect(issue).toContain('href="https://gitlab.com/acme/docs/-/issues/new?issue%5Btitle%5D=Docs%20feedback%3A%20%2Fguides%2Fstart"')
  })

  it('keeps the GitHub label and hides placeholders', () => {
    expect(renderToStaticMarkup(createElement(EditOnRepository, { pageId: 'a', repoUrl: 'https://github.com/x/y' }))).toContain(
      'Edit this page on GitHub',
    )
    expect(renderToStaticMarkup(createElement(ReportAnIssue, { pagePath: '/', repoUrl: 'https://github.com/your-org/docs' }))).toBe('')
  })

  it('reports code samples to GitLab with GitLab prefill keys', () => {
    const url = new URL(buildCodeReportUrl({
      repositoryUrl: 'https://gitlab.com/acme/docs',
      pageUrl: 'https://docs.acme.test/start',
      code: 'npm i',
    }) ?? '')
    expect(url.pathname).toBe('/acme/docs/-/issues/new')
    expect(url.searchParams.get('issue[title]')).toBe('Docs: incorrect code sample')
    expect(url.searchParams.get('issue[description]')).toContain('npm i')
  })
})

describe('getGitHosts', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('merges docs.json declarations with THALLY_GIT_HOSTS, the environment winning', async () => {
    vi.doMock('@/lib/docs-json-config', () => ({
      getDocsJsonConfig: () => ({
        tabs: [],
        repository: { hosts: [{ host: 'git.example.com', provider: 'github' }, { host: 'docs.example.com', provider: 'gitlab' }] },
      }),
    }))
    vi.stubEnv('THALLY_GIT_HOSTS', 'git.example.com=gitlab')
    const { getGitHosts } = await import('@/lib/git-hosts')
    expect(getGitHosts()).toEqual([
      { host: 'git.example.com', provider: 'gitlab' },
      { host: 'docs.example.com', provider: 'gitlab' },
    ])
  })

  it('falls back to DOX_GIT_HOSTS', async () => {
    vi.doMock('@/lib/docs-json-config', () => ({ getDocsJsonConfig: () => ({ tabs: [] }) }))
    vi.stubEnv('THALLY_GIT_HOSTS', '')
    vi.stubEnv('DOX_GIT_HOSTS', 'legacy.example.com=gitlab')
    const { getGitHosts } = await import('@/lib/git-hosts')
    expect(getGitHosts()).toEqual([{ host: 'legacy.example.com', provider: 'gitlab' }])
  })
})
