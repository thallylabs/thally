/** GitLab merge-request context, provider detection, and token-safe pushes. */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolvePrContext, TrackOwnedChangeError } from '../context.js'
import { originRemoteUrl, pushWithToken, redactRemoteUrl } from '../git.js'
import { resolvePullRequestOpener } from '../run.js'

type Call = { url: string }

function routedFetch(routes: Array<[string, unknown]>, calls: Array<Call>) {
  return (async (url: unknown) => {
    const href = String(url)
    calls.push({ url: href })
    const match = routes.find(([fragment]) => href.includes(fragment))
    return { ok: Boolean(match), status: match ? 200 : 404, json: async () => match?.[1] } as Response
  }) as typeof fetch
}

const directories: Array<string> = []
const ENV = ['THALLY_GIT_HOSTS', 'DOX_GIT_HOSTS', 'GITLAB_CI', 'CI_SERVER_HOST', 'THALLY_GITLAB_TOKEN']
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const name of ENV) {
    saved[name] = process.env[name]
    delete process.env[name]
  }
})
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
})

function gitRepo(origin?: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'thally-agent-git-'))
  directories.push(directory)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: directory })
  if (origin) execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: directory })
  return directory
}

describe('resolvePrContext for GitLab', () => {
  it('builds context from a merge request URL through the API', async () => {
    const calls: Array<Call> = []
    const context = await resolvePrContext('https://gitlab.com/acme/platform/api/-/merge_requests/12', {
      fetchImpl: routedFetch(
        [
          ['/diffs', [{ new_path: 'src/a.ts', diff: '+x\n' }]],
          ['/merge_requests/12', { iid: 12, title: 'Limits', description: 'Adds limits', web_url: 'https://gitlab.com/acme/platform/api/-/merge_requests/12' }],
        ],
        calls,
      ),
    })
    expect(calls[0].url).toBe('https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fapi/merge_requests/12')
    expect(context.split('\n')[0]).toBe('# Merged MR acme/platform/api!12: Limits')
    expect(context).toContain('### src/a.ts (modified, +1/-0)')
  })

  it('resolves a merge commit to its merge request on a self-hosted CI server', async () => {
    process.env.GITLAB_CI = 'true'
    process.env.CI_SERVER_HOST = 'git.example.com'
    const calls: Array<Call> = []
    const context = await resolvePrContext('https://git.example.com/team/app/-/commit/abcdef1234', {
      fetchImpl: routedFetch(
        [
          ['/diffs', []],
          ['/repository/commits/abcdef1234/merge_requests', [{ iid: 3, title: 'T', merged_at: '2026-10-01T00:00:00Z', source_branch: 'feature' }]],
        ],
        calls,
      ),
    })
    expect(calls[0].url).toBe('https://git.example.com/api/v4/projects/team%2Fapp/repository/commits/abcdef1234/merge_requests')
    expect(context).toContain('team/app!3')
  })

  it('skips merge commits from Track-owned branches', async () => {
    await expect(
      resolvePrContext('https://gitlab.com/acme/docs/-/commit/abcdef1', {
        fetchImpl: routedFetch([['/merge_requests', [{ iid: 9, merged_at: 'x', source_branch: 'thally/agent-abc' }]]], []),
      }),
    ).rejects.toBeInstanceOf(TrackOwnedChangeError)
  })
})

describe('provider detection and pushes', () => {
  it('redacts credentials from remotes', () => {
    expect(redactRemoteUrl('https://gitlab-ci-token:secret@gitlab.com/g/p.git')).toBe('https://gitlab.com/g/p.git')
    expect(redactRemoteUrl('git@gitlab.com:g/p.git')).toBe('git@gitlab.com:g/p.git')
    expect(originRemoteUrl(gitRepo('https://u:t@gitlab.com/g/p.git'))).toBe('https://gitlab.com/g/p.git')
    expect(originRemoteUrl(gitRepo())).toBeNull()
  })

  it('opens merge requests for GitLab origins and pull requests otherwise', () => {
    expect(resolvePullRequestOpener(gitRepo('git@gitlab.com:acme/docs.git')).provider).toBe('gitlab')
    expect(resolvePullRequestOpener(gitRepo('https://github.com/acme/docs.git')).provider).toBe('github')
    expect(resolvePullRequestOpener(gitRepo()).provider).toBe('github')
    expect(resolvePullRequestOpener(gitRepo('https://code.corp.test/a/b.git'), { provider: 'gitlab' }).provider).toBe('gitlab')
    process.env.THALLY_GIT_HOSTS = 'code.corp.test=gitlab'
    expect(resolvePullRequestOpener(gitRepo('https://code.corp.test/a/b.git')).provider).toBe('gitlab')
  })

  it('pushes without writing the token to git config', () => {
    const remote = mkdtempSync(join(tmpdir(), 'thally-agent-remote-'))
    directories.push(remote)
    execFileSync('git', ['init', '-q', '--bare'], { cwd: remote })
    const repo = gitRepo(remote)
    writeFileSync(join(repo, 'a.md'), 'x\n')
    execFileSync('git', ['add', '.'], { cwd: repo })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x'], { cwd: repo })
    pushWithToken(repo, 'thally/agent-test', remote, { username: 'oauth2', token: 'super-secret' })
    expect(execFileSync('git', ['branch', '--list', 'thally/agent-test'], { cwd: remote, encoding: 'utf8' })).toContain('thally/agent-test')
    expect(readFileSync(join(repo, '.git', 'config'), 'utf8')).not.toContain('super-secret')
    expect(() => pushWithToken(repo, 'b', remote, { username: 'x; rm', token: 't' })).toThrow('Invalid git username')
  })
})
