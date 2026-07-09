import { describe, it, expect } from 'vitest'
import {
  parseOwnerRepo,
  fetchCommit,
  fetchCompare,
  matchesGlob,
  filterFilesByGlobs,
  buildTrackTask,
  TRACK_CONTEXT_CHAR_CAP,
} from '../lib/track.js'

function fakeFetch(status: number, json: unknown, calls: Array<{ url: string; init?: RequestInit }> = []) {
  const impl = (async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
    } as Response
  }) as typeof fetch
  return { impl, calls }
}

describe('parseOwnerRepo', () => {
  it('parses owner/repo', () => {
    expect(parseOwnerRepo('acme/api-server')).toEqual({ owner: 'acme', repo: 'api-server' })
  })
  it('parses owner/repo@sha', () => {
    expect(parseOwnerRepo('acme/api@8c1f2ab')).toEqual({ owner: 'acme', repo: 'api', sha: '8c1f2ab' })
  })
  it('parses github URLs (with .git and trailing path)', () => {
    expect(parseOwnerRepo('https://github.com/acme/api.git')).toEqual({ owner: 'acme', repo: 'api' })
    expect(parseOwnerRepo('https://github.com/acme/api/tree/main')).toEqual({ owner: 'acme', repo: 'api' })
  })
  it('captures a pinned sha from a /commit/<sha> URL', () => {
    expect(parseOwnerRepo('https://github.com/acme/api/commit/8c1f2ab')).toEqual({
      owner: 'acme',
      repo: 'api',
      sha: '8c1f2ab',
    })
    // /tree/<branch-name> is not a sha and must NOT be captured as one
    expect(parseOwnerRepo('https://github.com/acme/api/tree/develop')).toEqual({ owner: 'acme', repo: 'api' })
  })
  it('rejects garbage', () => {
    expect(parseOwnerRepo('not a repo')).toBeNull()
    expect(parseOwnerRepo('onlyowner')).toBeNull()
    expect(parseOwnerRepo('')).toBeNull()
  })
})

describe('matchesGlob', () => {
  const cases: Array<[string, string, boolean]> = [
    ['src/**', 'src/a/b.ts', true],
    ['src/**', 'src/top.ts', true],
    ['src/**', 'lib/x.ts', false],
    ['**/*.md', 'README.md', true],
    ['**/*.md', 'docs/deep/page.md', true],
    ['**/*.md', 'docs/page.mdx', false],
    ['openapi.yaml', 'openapi.yaml', true],
    ['openapi.yaml', 'sub/openapi.yaml', false],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/a/b.ts', false],
    ['file?.ts', 'file1.ts', true],
    ['file?.ts', 'file12.ts', false],
    ['./src/**', 'src/a.ts', true],
  ]
  for (const [pattern, path, expected] of cases) {
    it(`${pattern} vs ${path} → ${expected}`, () => {
      expect(matchesGlob(pattern, path)).toBe(expected)
    })
  }
})

describe('filterFilesByGlobs', () => {
  const files = [{ filename: 'src/a.ts' }, { filename: 'docs/b.md' }, { filename: 'openapi.yaml' }]
  it('absent globs match everything', () => {
    expect(filterFilesByGlobs(files)).toHaveLength(3)
    expect(filterFilesByGlobs(files, [])).toHaveLength(3)
  })
  it('filters by any-of globs', () => {
    expect(filterFilesByGlobs(files, ['src/**', 'openapi.yaml']).map((f) => f.filename)).toEqual([
      'src/a.ts',
      'openapi.yaml',
    ])
  })
})

describe('fetchCommit / fetchCompare', () => {
  it('fetches a commit and maps files', async () => {
    const { impl, calls } = fakeFetch(200, {
      sha: 'abc1234def',
      html_url: 'https://github.com/a/b/commit/abc1234def',
      commit: { message: 'feat: add payments', author: { name: 'Kay' } },
      author: { login: 'kay' },
      files: [{ filename: 'src/pay.ts', status: 'added', additions: 10, deletions: 0, patch: '+code' }],
    })
    const info = await fetchCommit('a', 'b', 'abc1234def', { fetchImpl: impl, token: 't0k' })
    expect(info.sha).toBe('abc1234def')
    expect(info.author).toBe('kay')
    expect(info.files[0]).toMatchObject({ filename: 'src/pay.ts', patch: '+code' })
    expect(calls[0].url).toBe('https://api.github.com/repos/a/b/commits/abc1234def')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer t0k')
  })

  it('omits the auth header without a token', async () => {
    const { impl, calls } = fakeFetch(200, { sha: 'x', files: [] })
    await fetchCommit('a', 'b', 'x', { fetchImpl: impl, token: undefined })
    const headers = calls[0].init?.headers as Record<string, string>
    // Env tokens may leak in from the shell — only assert when none present.
    if (!process.env.DOX_GITHUB_TOKEN && !process.env.GH_TOKEN && !process.env.GITHUB_TOKEN && !process.env.DOX_TASKS_TOKEN) {
      expect(headers.Authorization).toBeUndefined()
    }
    expect(headers.Accept).toBe('application/vnd.github+json')
  })

  it('throws a hint on 404', async () => {
    const { impl } = fakeFetch(404, {})
    await expect(fetchCommit('a', 'b', 'nope', { fetchImpl: impl })).rejects.toThrow(/DOX_GITHUB_TOKEN/)
  })

  it('compare aggregates the range and uses the head commit sha', async () => {
    const { impl, calls } = fakeFetch(200, {
      commits: [{ sha: 'head99', commit: { message: 'last', author: { name: 'n' } } }],
      files: [{ filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 1 }],
    })
    const info = await fetchCompare('a', 'b', 'base00', 'head99', { fetchImpl: impl })
    expect(info.sha).toBe('head99')
    expect(info.files).toHaveLength(1)
    expect(calls[0].url).toContain('/compare/base00...head99')
  })
})

describe('buildTrackTask', () => {
  const commit = {
    sha: '8c1f2ab000000',
    message: 'feat: payments API\n\nlong body',
    author: 'kay',
    htmlUrl: 'https://github.com/acme/api/commit/8c1f2ab',
    files: [
      { filename: 'src/pay.ts', status: 'added', additions: 10, deletions: 0, patch: '+pay()' },
      { filename: 'assets/logo.png', status: 'added', additions: 0, deletions: 0 },
    ],
  }

  it('frames the judgment-call job with placement, no shell-breaking quotes', () => {
    const task = buildTrackTask(
      { owner: 'acme', repo: 'api', outputTab: 'API Reference', outputGroup: 'Payments' },
      commit,
    )
    expect(task.instruction).toContain('acme/api@8c1f2ab')
    expect(task.instruction).toContain('feat: payments API')
    expect(task.instruction).toContain('API Reference tab (Payments group)')
    // Judgment-call framing — find & update affected docs, not a source→page map.
    expect(task.instruction).toMatch(/Review the diff/i)
    expect(task.instruction).toMatch(/find the documentation pages/i)
    expect(task.instruction).not.toMatch(/sources|verifiedCommit/)
    // Must not embed double quotes — the instruction lands in a shell env var
    // but should never contain metacharacters that could break/inject a script.
    expect(task.instruction).not.toContain('"')
  })

  it('renders per-file sections and flags binary files', () => {
    const task = buildTrackTask({ owner: 'acme', repo: 'api' }, commit)
    expect(task.context).toContain('### src/pay.ts (added, +10/-0)')
    expect(task.context).toContain('```diff\n+pay()\n```')
    expect(task.context).toContain('logo.png')
    expect(task.context).toContain('no text diff')
  })

  it('caps the context and notes truncation', () => {
    const bigFiles = Array.from({ length: 50 }, (_, i) => ({
      filename: `src/f${i}.ts`,
      status: 'modified',
      additions: 1,
      deletions: 1,
      patch: 'x'.repeat(1000),
    }))
    const task = buildTrackTask({ owner: 'a', repo: 'b' }, { ...commit, files: bigFiles })
    expect(task.context.length).toBeLessThanOrEqual(TRACK_CONTEXT_CHAR_CAP)
    expect(task.context).toContain('truncated')
  })
})
