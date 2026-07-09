import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyGithubSignature, matchPushEvent, processPush } from '@/lib/track/webhook'
import { createMemoryAdapter } from '@/lib/storage'
import type { TrackingConfig } from '@/data/docs'

const SECRET = 'test-secret'

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

const TRACKING: TrackingConfig = {
  repos: [{ owner: 'acme', repo: 'api', branch: 'main', paths: ['src/**'] }],
}

function pushPayload(overrides: Record<string, unknown> = {}) {
  return {
    ref: 'refs/heads/main',
    before: 'a'.repeat(40),
    after: 'b'.repeat(40),
    repository: { full_name: 'acme/api' },
    pusher: { name: 'kay' },
    commits: [{ added: ['src/new.ts'], removed: [], modified: ['README.md'] }],
    head_commit: { added: [], removed: [], modified: ['src/new.ts'] },
    ...overrides,
  }
}

describe('verifyGithubSignature', () => {
  const body = '{"hello":"world"}'
  it('accepts a valid signature', () => {
    expect(verifyGithubSignature(body, sign(body), SECRET)).toBe(true)
  })
  it('rejects a tampered body', () => {
    expect(verifyGithubSignature(body + ' ', sign(body), SECRET)).toBe(false)
  })
  it('rejects a wrong secret', () => {
    expect(verifyGithubSignature(body, sign(body, 'other'), SECRET)).toBe(false)
  })
  it('rejects missing/short/unprefixed headers without throwing', () => {
    expect(verifyGithubSignature(body, null, SECRET)).toBe(false)
    expect(verifyGithubSignature(body, 'sha256=abc', SECRET)).toBe(false)
    expect(verifyGithubSignature(body, 'md5=whatever', SECRET)).toBe(false)
  })
})

describe('matchPushEvent', () => {
  it('matches a tracked repo/branch push touching tracked paths', () => {
    const match = matchPushEvent(pushPayload(), TRACKING)
    expect(match).not.toBeNull()
    expect(match!.matchedFiles).toEqual(['src/new.ts'])
    expect(match!.requester).toBe('kay')
  })
  it('is case-insensitive on the repo name', () => {
    expect(matchPushEvent(pushPayload({ repository: { full_name: 'Acme/API' } }), TRACKING)).not.toBeNull()
  })
  it('ignores tag pushes', () => {
    expect(matchPushEvent(pushPayload({ ref: 'refs/tags/v1.0' }), TRACKING)).toBeNull()
  })
  it('ignores branch deletions', () => {
    expect(matchPushEvent(pushPayload({ deleted: true }), TRACKING)).toBeNull()
    expect(matchPushEvent(pushPayload({ after: '0'.repeat(40) }), TRACKING)).toBeNull()
  })
  it('ignores untracked branches and repos', () => {
    expect(matchPushEvent(pushPayload({ ref: 'refs/heads/dev' }), TRACKING)).toBeNull()
    expect(matchPushEvent(pushPayload({ repository: { full_name: 'other/repo' } }), TRACKING)).toBeNull()
  })
  it('flattens paths across ALL commits (not just head_commit)', () => {
    const match = matchPushEvent(
      pushPayload({
        commits: [
          { added: [], removed: [], modified: ['docs/x.md'] },
          { added: ['src/deep/thing.ts'], removed: [], modified: [] },
        ],
        head_commit: { added: [], removed: [], modified: ['docs/x.md'] },
      }),
      TRACKING,
    )
    expect(match!.matchedFiles).toEqual(['src/deep/thing.ts'])
  })
  it('falls back to head_commit when commits[] is empty (force-push)', () => {
    const match = matchPushEvent(pushPayload({ commits: [] }), TRACKING)
    expect(match!.matchedFiles).toEqual(['src/new.ts'])
  })
  it('returns null when no tracked path is touched', () => {
    expect(
      matchPushEvent(
        pushPayload({ commits: [{ added: [], removed: [], modified: ['README.md'] }], head_commit: null }),
        TRACKING,
      ),
    ).toBeNull()
  })
})

describe('processPush', () => {
  const baseMatch = () => matchPushEvent(pushPayload(), TRACKING)!

  function fakeDispatchFetch(calls: Array<{ url: string; body: unknown }> = [], status = 204) {
    const impl = (async (url: unknown, init?: unknown) => {
      const request = init as RequestInit
      calls.push({ url: String(url), body: request?.body ? JSON.parse(String(request.body)) : undefined })
      // Distiller calls (GET) return a minimal commit; dispatch (POST) returns status.
      if (!request?.method || request.method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ sha: 'b'.repeat(40), files: [{ filename: 'src/new.ts', status: 'added', additions: 1, deletions: 0 }], commits: [] }) } as Response
      }
      return { ok: status < 300, status, json: async () => ({}) } as Response
    }) as typeof fetch
    return { impl, calls }
  }

  it('dispatches and records the SHA', async () => {
    const storage = createMemoryAdapter()
    const { impl, calls } = fakeDispatchFetch()
    const result = await processPush(baseMatch(), { storage, docsRepo: 'acme/docs', token: 't', fetchImpl: impl })
    expect(result.status).toBe('dispatched')
    const dispatch = calls.find((c) => c.url.endsWith('/dispatches'))
    expect(dispatch).toBeTruthy()
    expect((dispatch!.body as { event_type: string }).event_type).toBe('dox-document')
    expect((dispatch!.body as { client_payload: { from_commit: string } }).client_payload.from_commit).toBe(
      `acme/api@${'b'.repeat(40)}`,
    )
    expect(await storage.kvGet('track_state', 'acme/api@main')).toBe('b'.repeat(40))
  })

  it('dedupes a redelivered push', async () => {
    const storage = createMemoryAdapter()
    await storage.kvSet('track_state', 'acme/api@main', 'b'.repeat(40))
    const result = await processPush(baseMatch(), { storage, docsRepo: 'acme/docs', token: 't', fetchImpl: fakeDispatchFetch().impl })
    expect(result).toEqual({ status: 'noop', reason: 'already_synced' })
  })

  it('noops without a docs repo or token (never throws)', async () => {
    const storage = createMemoryAdapter()
    expect((await processPush(baseMatch(), { storage, docsRepo: null, token: 't' })).reason).toBe('no_docs_repo_configured')
    const prevTokens = [process.env.DOX_GITHUB_TOKEN, process.env.DOX_TASKS_TOKEN]
    delete process.env.DOX_GITHUB_TOKEN
    delete process.env.DOX_TASKS_TOKEN
    expect((await processPush(baseMatch(), { storage, docsRepo: 'acme/docs' })).reason).toBe('no_github_token')
    if (prevTokens[0]) process.env.DOX_GITHUB_TOKEN = prevTokens[0]
    if (prevTokens[1]) process.env.DOX_TASKS_TOKEN = prevTokens[1]
  })

  it('reports a failed dispatch as a noop with the status', async () => {
    const storage = createMemoryAdapter()
    const { impl } = fakeDispatchFetch([], 422)
    const result = await processPush(baseMatch(), { storage, docsRepo: 'acme/docs', token: 't', fetchImpl: impl })
    expect(result).toEqual({ status: 'noop', reason: 'dispatch_failed_422' })
    // SHA must NOT be recorded on failure.
    expect(await storage.kvGet('track_state', 'acme/api@main')).toBeNull()
  })
})
