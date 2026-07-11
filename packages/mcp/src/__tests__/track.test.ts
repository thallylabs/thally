import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import {
  parseOwnerRepo,
  fetchPullRequest,
  fetchPullRequestFiles,
  fetchLatestMergedPr,
  matchesGlob,
  filterFilesByGlobs,
  buildTrackTask,
  buildTrackInstruction,
  mintInstallationToken,
  resolveGithubToken,
  verifyInstallationBelongsToApp,
  TRACK_CONTEXT_CHAR_CAP,
} from '../lib/track.js'

function throwawayKey(): string {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey
}

function fakeFetch(status: number, json: unknown, calls: Array<{ url: string; init?: RequestInit }> = []) {
  const impl = (async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit })
    return { ok: status >= 200 && status < 300, status, json: async () => json } as Response
  }) as typeof fetch
  return { impl, calls }
}

describe('parseOwnerRepo', () => {
  it('parses owner/repo', () => {
    expect(parseOwnerRepo('acme/api-server')).toEqual({ owner: 'acme', repo: 'api-server' })
  })
  it('parses owner/repo#123 (PR number)', () => {
    expect(parseOwnerRepo('acme/api#42')).toEqual({ owner: 'acme', repo: 'api', pr: 42 })
  })
  it('captures a PR number from a /pull/<n> URL', () => {
    expect(parseOwnerRepo('https://github.com/acme/api/pull/42')).toEqual({ owner: 'acme', repo: 'api', pr: 42 })
    // a bare repo URL has no pr
    expect(parseOwnerRepo('https://github.com/acme/api.git')).toEqual({ owner: 'acme', repo: 'api' })
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

describe('fetchPullRequest / fetchPullRequestFiles / fetchLatestMergedPr', () => {
  it('fetches PR metadata', async () => {
    const { impl, calls } = fakeFetch(200, {
      number: 42,
      title: 'Add payments API',
      body: 'Adds /pay',
      html_url: 'https://github.com/a/b/pull/42',
      base: { ref: 'main' },
      merge_commit_sha: 'abc123',
      user: { login: 'kay' },
    })
    const pr = await fetchPullRequest('a', 'b', 42, { fetchImpl: impl, token: 't0k' })
    expect(pr).toMatchObject({ number: 42, title: 'Add payments API', baseRef: 'main', author: 'kay' })
    expect(calls[0].url).toBe('https://api.github.com/repos/a/b/pulls/42')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer t0k')
  })

  it('fetches PR files with patches', async () => {
    const { impl, calls } = fakeFetch(200, [
      { filename: 'src/pay.ts', status: 'added', additions: 10, deletions: 0, patch: '+code' },
    ])
    const files = await fetchPullRequestFiles('a', 'b', 42, { fetchImpl: impl })
    expect(files[0]).toMatchObject({ filename: 'src/pay.ts', patch: '+code' })
    expect(calls[0].url).toContain('/pulls/42/files')
  })

  it('paginates PR files past the first 100 (a tracked file beyond page 1 is not lost)', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ filename: `src/f${i}.ts`, status: 'modified', additions: 1, deletions: 0 }))
    const page2 = [{ filename: 'openapi.yaml', status: 'modified', additions: 1, deletions: 0 }]
    const urls: Array<string> = []
    const impl = (async (url: unknown) => {
      urls.push(String(url))
      const page = new URL(String(url)).searchParams.get('page')
      return { ok: true, status: 200, json: async () => (page === '1' ? page1 : page === '2' ? page2 : []) } as Response
    }) as typeof fetch
    const files = await fetchPullRequestFiles('a', 'b', 42, { fetchImpl: impl })
    expect(files).toHaveLength(101)
    expect(files.some((f) => f.filename === 'openapi.yaml')).toBe(true)
    expect(urls.some((u) => u.includes('page=2'))).toBe(true)
  })

  it('picks the most-recently-MERGED PR, not the most-recently-updated', async () => {
    // Returned in updated-desc order: #9 was touched today but merged in January;
    // #8 merged in June. The latest MERGE is #8, even though #9 sorts first.
    const { impl } = fakeFetch(200, [
      { number: 9, base: { ref: 'main' }, merged_at: '2026-01-01T00:00:00Z', html_url: 'u9', title: 'old merge, touched today' },
      { number: 8, base: { ref: 'main' }, merged_at: '2026-06-01T00:00:00Z', html_url: 'u8', title: 'recent merge' },
    ])
    const pr = await fetchLatestMergedPr('a', 'b', 'main', { fetchImpl: impl })
    expect(pr?.number).toBe(8)
  })

  it('finds the latest MERGED PR into the base (skips unmerged closes)', async () => {
    const { impl, calls } = fakeFetch(200, [
      { number: 9, title: 'closed not merged', base: { ref: 'main' }, merged_at: null, html_url: 'u9' },
      { number: 8, title: 'the merge', base: { ref: 'main' }, merged_at: '2026-01-01', html_url: 'u8' },
    ])
    const pr = await fetchLatestMergedPr('a', 'b', 'main', { fetchImpl: impl })
    expect(pr?.number).toBe(8)
    expect(calls[0].url).toContain('state=closed')
    expect(calls[0].url).toContain('base=main')
  })

  it('returns null when there is no merged PR', async () => {
    const { impl } = fakeFetch(200, [{ number: 9, merged_at: null, base: { ref: 'main' } }])
    expect(await fetchLatestMergedPr('a', 'b', 'main', { fetchImpl: impl })).toBeNull()
  })

  it('throws a hint on 404', async () => {
    const { impl } = fakeFetch(404, {})
    await expect(fetchPullRequest('a', 'b', 1, { fetchImpl: impl })).rejects.toThrow(/THALLY_GITHUB_TOKEN/)
  })
})

describe('buildTrackInstruction / buildTrackTask', () => {
  const pr = {
    number: 42,
    title: 'Add payments API',
    body: 'Adds a /pay endpoint',
    htmlUrl: 'https://github.com/acme/api/pull/42',
    baseRef: 'main',
    author: 'kay',
  }
  const files = [
    { filename: 'src/pay.ts', status: 'added', additions: 10, deletions: 0, patch: '+pay()' },
    { filename: 'assets/logo.png', status: 'added', additions: 0, deletions: 0 },
  ]

  it('frames the judgment-call job around the merged PR, with placement, no shell-breaking quotes', () => {
    const instruction = buildTrackInstruction(
      { owner: 'acme', repo: 'api', outputTab: 'API Reference', outputGroup: 'Payments' },
      pr,
    )
    expect(instruction).toContain('merged in acme/api (#42)')
    expect(instruction).toContain('API Reference tab (Payments group)')
    expect(instruction).toMatch(/Review it/i)
    expect(instruction).toMatch(/find the documentation pages/i)
    // The (attacker-influenced) PR title must NOT be embedded — it lands in a shell env var.
    expect(instruction).not.toContain('Add payments API')
    expect(instruction).not.toContain('"')
  })

  it('builds context from the PR description + file diffs, flags binary files', () => {
    const task = buildTrackTask({ owner: 'acme', repo: 'api' }, pr, files)
    expect(task.context).toContain('# Merged PR acme/api#42: Add payments API')
    expect(task.context).toContain('Adds a /pay endpoint')
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
    const task = buildTrackTask({ owner: 'a', repo: 'b' }, pr, bigFiles)
    expect(task.context.length).toBeLessThanOrEqual(TRACK_CONTEXT_CHAR_CAP)
    expect(task.context).toContain('truncated')
  })

  it('reframes the instruction for preview (open) PRs, still no shell-breaking quotes', () => {
    const preview = buildTrackInstruction({ owner: 'acme', repo: 'api' }, pr, { preview: true })
    expect(preview).toMatch(/open pull request in acme\/api \(#42\)/i)
    expect(preview).toMatch(/preview/i)
    expect(preview).not.toContain('merged in acme/api')
    expect(preview).not.toContain('"')
  })
})

describe('mintInstallationToken / resolveGithubToken', () => {
  it('signs an RS256 JWT, exchanges it, and caches the installation token', async () => {
    const privateKey = throwawayKey()
    let sentAuth = ''
    let calls = 0
    const fetchImpl = (async (_url: unknown, init?: unknown) => {
      calls++
      sentAuth = (init as RequestInit).headers ? (init as { headers: Record<string, string> }).headers.Authorization : ''
      return { ok: true, status: 201, json: async () => ({ token: 'ghs_xyz', expires_at: new Date(Date.now() + 3600e3).toISOString() }) } as Response
    }) as typeof fetch

    const creds = { appId: 12345, installationId: 777001, privateKey }
    const token = await mintInstallationToken(creds, fetchImpl)
    expect(token).toBe('ghs_xyz')
    // A Bearer JWT (three base64url segments) was sent, not a PAT.
    expect(sentAuth.startsWith('Bearer ')).toBe(true)
    expect(sentAuth.replace('Bearer ', '').split('.')).toHaveLength(3)
    // Second call for the same installation is served from cache (no new fetch).
    await mintInstallationToken(creds, fetchImpl)
    expect(calls).toBe(1)
  })

  it('prefers an explicit token, then App creds, over the env PAT chain', async () => {
    const prevPat = process.env.THALLY_GITHUB_TOKEN
    process.env.THALLY_GITHUB_TOKEN = 'pat_env'
    try {
      // explicit wins
      expect(await resolveGithubToken({ token: 'explicit' })).toBe('explicit')
      // App creds beat the env PAT
      const fetchImpl = (async () =>
        ({ ok: true, status: 201, json: async () => ({ token: 'ghs_app', expires_at: new Date(Date.now() + 3600e3).toISOString() }) }) as Response) as typeof fetch
      const viaApp = await resolveGithubToken({
        appCreds: { appId: 1, installationId: 777002, privateKey: throwawayKey() },
        fetchImpl,
      })
      expect(viaApp).toBe('ghs_app')
      // Nothing explicit / no app → env PAT
      expect(await resolveGithubToken()).toBe('pat_env')

      // App mint FAILS but a PAT is configured → fall back to the PAT (Track
      // stays online) instead of throwing.
      const failFetch = (async () => ({ ok: false, status: 403, json: async () => ({}) }) as Response) as typeof fetch
      const fellBack = await resolveGithubToken({
        appCreds: { appId: 1, installationId: 777003, privateKey: throwawayKey() },
        fetchImpl: failFetch,
      })
      expect(fellBack).toBe('pat_env')
    } finally {
      if (prevPat === undefined) delete process.env.THALLY_GITHUB_TOKEN
      else process.env.THALLY_GITHUB_TOKEN = prevPat
    }
  })

  it('returns undefined (does not throw) when App mint fails and no PAT is set', async () => {
    const prev = {
      a: process.env.THALLY_GITHUB_TOKEN,
      b: process.env.THALLY_TASKS_TOKEN,
      c: process.env.GH_TOKEN,
      d: process.env.GITHUB_TOKEN,
      // Legacy fallback names still participate in the resolver chain.
      e: process.env.DOX_GITHUB_TOKEN,
      f: process.env.DOX_TASKS_TOKEN,
    }
    delete process.env.THALLY_GITHUB_TOKEN
    delete process.env.THALLY_TASKS_TOKEN
    delete process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN
    delete process.env.DOX_GITHUB_TOKEN
    delete process.env.DOX_TASKS_TOKEN
    try {
      const failFetch = (async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response) as typeof fetch
      const token = await resolveGithubToken({
        appCreds: { appId: 1, installationId: 777004, privateKey: throwawayKey() },
        fetchImpl: failFetch,
      })
      expect(token).toBeUndefined()
    } finally {
      if (prev.a !== undefined) process.env.THALLY_GITHUB_TOKEN = prev.a
      if (prev.b !== undefined) process.env.THALLY_TASKS_TOKEN = prev.b
      if (prev.c !== undefined) process.env.GH_TOKEN = prev.c
      if (prev.d !== undefined) process.env.GITHUB_TOKEN = prev.d
      if (prev.e !== undefined) process.env.DOX_GITHUB_TOKEN = prev.e
      if (prev.f !== undefined) process.env.DOX_TASKS_TOKEN = prev.f
    }
  })
})

describe('verifyInstallationBelongsToApp', () => {
  it('is true only when the installation\'s app_id matches (CSRF guard for the install callback)', async () => {
    const key = throwawayKey()
    const match = (async () => ({ ok: true, status: 200, json: async () => ({ app_id: 42 }) }) as Response) as typeof fetch
    expect(await verifyInstallationBelongsToApp(42, key, 999, match)).toBe(true)

    // A real installation but belonging to a DIFFERENT app → reject.
    const foreign = (async () => ({ ok: true, status: 200, json: async () => ({ app_id: 7 }) }) as Response) as typeof fetch
    expect(await verifyInstallationBelongsToApp(42, key, 999, foreign)).toBe(false)

    // Unknown/forged installation id → 404 → reject.
    const notFound = (async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response) as typeof fetch
    expect(await verifyInstallationBelongsToApp(42, key, 123456, notFound)).toBe(false)
  })
})
