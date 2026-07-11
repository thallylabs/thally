import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyGithubSignature, matchPullRequestEvent, processPullRequest } from '@/lib/track/webhook'
import { createMemoryAdapter } from '@/lib/storage'
import type { TrackingConfig } from '@/data/docs'

const SECRET = 'test-secret'

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

const TRACKING: TrackingConfig = {
  repos: [{ owner: 'acme', repo: 'api', branch: 'main', paths: ['src/**'] }],
}

function prPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'closed',
    pull_request: {
      number: 42,
      title: 'Add payments',
      html_url: 'https://github.com/acme/api/pull/42',
      merged: true,
      base: { ref: 'main' },
      user: { login: 'kay' },
      ...(overrides.pull_request as object),
    },
    repository: { full_name: 'acme/api' },
    ...overrides,
  }
}

describe('verifyGithubSignature', () => {
  const body = '{"hello":"world"}'
  it('accepts a valid signature', () => {
    expect(verifyGithubSignature(body, sign(body), SECRET)).toBe(true)
  })
  it('rejects a tampered body / wrong secret / missing header without throwing', () => {
    expect(verifyGithubSignature(body + ' ', sign(body), SECRET)).toBe(false)
    expect(verifyGithubSignature(body, sign(body, 'other'), SECRET)).toBe(false)
    expect(verifyGithubSignature(body, null, SECRET)).toBe(false)
    expect(verifyGithubSignature(body, 'sha256=abc', SECRET)).toBe(false)
  })
})

describe('matchPullRequestEvent', () => {
  it('matches a merged PR into the tracked base branch', () => {
    const match = matchPullRequestEvent(prPayload(), TRACKING)
    expect(match).not.toBeNull()
    expect(match!.number).toBe(42)
    expect(match!.requester).toBe('kay')
    expect(match!.htmlUrl).toBe('https://github.com/acme/api/pull/42')
  })
  it('ignores a closed-but-not-merged PR', () => {
    expect(matchPullRequestEvent(prPayload({ pull_request: { merged: false } }), TRACKING)).toBeNull()
  })
  it('ignores non-closed actions (opened / synchronize)', () => {
    expect(matchPullRequestEvent(prPayload({ action: 'opened' }), TRACKING)).toBeNull()
    expect(matchPullRequestEvent(prPayload({ action: 'synchronize' }), TRACKING)).toBeNull()
  })
  it('ignores a merge into a different base branch', () => {
    expect(matchPullRequestEvent(prPayload({ pull_request: { base: { ref: 'develop' } } }), TRACKING)).toBeNull()
  })
  it('ignores untracked repos (case-insensitive match on tracked)', () => {
    expect(matchPullRequestEvent(prPayload({ repository: { full_name: 'other/repo' } }), TRACKING)).toBeNull()
    expect(matchPullRequestEvent(prPayload({ repository: { full_name: 'Acme/API' } }), TRACKING)).not.toBeNull()
  })

  it('tags a merged match with mode "merged"', () => {
    expect(matchPullRequestEvent(prPayload(), TRACKING)!.mode).toBe('merged')
  })

  // Loop guard — the docs agent's own PRs (thally/agent-*) must never re-trigger.
  it('ignores a merged PR from a thally/agent-* branch (loop guard)', () => {
    expect(
      matchPullRequestEvent(prPayload({ pull_request: { head: { ref: 'thally/agent-abc123' } } }), TRACKING),
    ).toBeNull()
  })

  // Preview mode — an OPEN PR labelled docs-preview. Built directly (not via
  // prPayload) so a full pull_request survives the overrides.
  const previewPayload = (pr: Record<string, unknown> = {}, action = 'labeled') => ({
    action,
    pull_request: {
      number: 42,
      title: 'Add payments',
      html_url: 'https://github.com/acme/api/pull/42',
      merged: false,
      base: { ref: 'main' },
      user: { login: 'kay' },
      head: { ref: 'feature/pay', sha: 'deadbeef' },
      labels: [{ name: 'docs-preview' }],
      ...pr,
    },
    repository: { full_name: 'acme/api' },
  })

  it('matches an open, docs-preview-labelled PR as mode "preview" with the head sha', () => {
    const match = matchPullRequestEvent(previewPayload(), TRACKING)
    expect(match).not.toBeNull()
    expect(match!.mode).toBe('preview')
    expect(match!.headSha).toBe('deadbeef')
  })
  it('accepts preview on synchronize (a push to a labelled PR)', () => {
    expect(matchPullRequestEvent(previewPayload({}, 'synchronize'), TRACKING)!.mode).toBe('preview')
  })
  it('ignores an open PR WITHOUT the docs-preview label', () => {
    expect(matchPullRequestEvent(previewPayload({ labels: [{ name: 'bug' }] }), TRACKING)).toBeNull()
  })
  it('ignores a docs-preview PR closed without merging', () => {
    expect(matchPullRequestEvent(previewPayload({ merged: false }, 'closed'), TRACKING)).toBeNull()
  })
  it('ignores a docs-preview label on a thally/agent-* branch (loop guard wins)', () => {
    expect(matchPullRequestEvent(previewPayload({ head: { ref: 'thally/agent-x', sha: 'z' } }), TRACKING)).toBeNull()
  })
})

describe('processPullRequest', () => {
  const baseMatch = () => matchPullRequestEvent(prPayload(), TRACKING)!

  // Returns files for the path-filter fetch (GET) and a status for the dispatch (POST).
  function fakeFetch(files: Array<{ filename: string }>, calls: Array<{ url: string; body: unknown }> = [], status = 204) {
    const impl = (async (url: unknown, init?: unknown) => {
      const request = init as RequestInit
      calls.push({ url: String(url), body: request?.body ? JSON.parse(String(request.body)) : undefined })
      if (!request?.method || request.method === 'GET') {
        return { ok: true, status: 200, json: async () => files } as Response
      }
      return { ok: status < 300, status, json: async () => ({}) } as Response
    }) as typeof fetch
    return { impl, calls }
  }

  it('dispatches from_pr and records the PR as synced', async () => {
    const storage = createMemoryAdapter()
    const { impl, calls } = fakeFetch([{ filename: 'src/pay.ts' }])
    const result = await processPullRequest(baseMatch(), { storage, docsRepo: 'acme/docs', token: 't', fetchImpl: impl })
    expect(result.status).toBe('dispatched')
    const dispatch = calls.find((c) => c.url.endsWith('/dispatches'))!
    expect((dispatch.body as { client_payload: { from_pr: string } }).client_payload.from_pr).toBe(
      'https://github.com/acme/api/pull/42',
    )
    expect((dispatch.body as { client_payload: { instruction: string } }).client_payload.instruction).toContain('#42')
    expect(await storage.kvGet('track_dedupe', 'acme/api#42')).toBeTruthy()
    // Admin-panel display key updated to the last PR on this branch.
    expect(await storage.kvGet('track_state', 'acme/api@main')).toBe('#42')
  })

  it('dedupes a redelivered merge (same PR number)', async () => {
    const storage = createMemoryAdapter()
    await storage.kvSet('track_dedupe', 'acme/api#42', 'seen')
    const result = await processPullRequest(baseMatch(), { storage, docsRepo: 'acme/docs', token: 't', fetchImpl: fakeFetch([]).impl })
    expect(result).toEqual({ status: 'noop', reason: 'already_synced' })
  })

  it('noops when the PR touches no tracked paths', async () => {
    const storage = createMemoryAdapter()
    const { impl } = fakeFetch([{ filename: 'README.md' }]) // not under src/**
    const result = await processPullRequest(baseMatch(), { storage, docsRepo: 'acme/docs', token: 't', fetchImpl: impl })
    expect(result).toEqual({ status: 'noop', reason: 'no_tracked_paths_in_pr' })
  })

  it('noops (no throw) without a docs repo', async () => {
    const storage = createMemoryAdapter()
    expect((await processPullRequest(baseMatch(), { storage, docsRepo: null, token: 't' })).reason).toBe(
      'no_docs_repo_configured',
    )
  })

  it('reports a failed dispatch as a noop and does NOT record the PR', async () => {
    const storage = createMemoryAdapter()
    const { impl } = fakeFetch([{ filename: 'src/pay.ts' }], [], 422)
    const result = await processPullRequest(baseMatch(), { storage, docsRepo: 'acme/docs', token: 't', fetchImpl: impl })
    expect(result).toEqual({ status: 'noop', reason: 'dispatch_failed_422' })
    expect(await storage.kvGet('track_dedupe', 'acme/api#42')).toBeNull()
  })

  // Preview processing — dedupe per head sha, flag the payload, and never touch
  // the "last synced" display key (an open preview is not a sync).
  const previewMatch = () =>
    matchPullRequestEvent(
      {
        action: 'labeled',
        pull_request: {
          number: 42,
          html_url: 'https://github.com/acme/api/pull/42',
          merged: false,
          base: { ref: 'main' },
          user: { login: 'kay' },
          head: { ref: 'feature/pay', sha: 'sha1' },
          labels: [{ name: 'docs-preview' }],
        },
        repository: { full_name: 'acme/api' },
      },
      TRACKING,
    )!

  it('dispatches a preview flagged preview:true, deduped by head sha, without a display-key write', async () => {
    const storage = createMemoryAdapter()
    const { impl, calls } = fakeFetch([{ filename: 'src/pay.ts' }])
    const result = await processPullRequest(previewMatch(), { storage, docsRepo: 'acme/docs', token: 't', fetchImpl: impl })
    expect(result.status).toBe('dispatched')
    const dispatch = calls.find((c) => c.url.endsWith('/dispatches'))!
    expect((dispatch.body as { client_payload: { preview: boolean } }).client_payload.preview).toBe(true)
    // Deduped under the sha-scoped key (in the dedupe namespace); the display
    // key in track_state is untouched (an open preview is not a "sync").
    expect(await storage.kvGet('track_dedupe', 'acme/api#42@sha1')).toBeTruthy()
    expect(await storage.kvGet('track_state', 'acme/api@main')).toBeNull()
  })

  it('re-dispatches a preview after a new push (different head sha)', async () => {
    const storage = createMemoryAdapter()
    await storage.kvSet('track_dedupe', 'acme/api#42@sha1', 'seen') // an earlier push
    const newer = matchPullRequestEvent(
      {
        action: 'synchronize',
        pull_request: {
          number: 42,
          html_url: 'https://github.com/acme/api/pull/42',
          merged: false,
          base: { ref: 'main' },
          user: { login: 'kay' },
          head: { ref: 'feature/pay', sha: 'sha2' },
          labels: [{ name: 'docs-preview' }],
        },
        repository: { full_name: 'acme/api' },
      },
      TRACKING,
    )!
    const { impl } = fakeFetch([{ filename: 'src/pay.ts' }])
    const result = await processPullRequest(newer, { storage, docsRepo: 'acme/docs', token: 't', fetchImpl: impl })
    expect(result.status).toBe('dispatched')
  })
})
