import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  fetchPullRequestFiles,
  filterFilesByGlobs,
  buildTrackInstruction,
  resolveGithubToken,
  AGENT_BRANCH_PREFIX,
  DOCS_PREVIEW_LABEL,
  type GithubAppCreds,
} from '@doxlabs/mcp/track'
import type { TrackingConfig, TrackingRepoConfig } from '@/data/docs'
import type { StorageAdapter } from '@/lib/storage/types'

// AGENT_BRANCH_PREFIX (loop guard) and DOCS_PREVIEW_LABEL are the single source
// of truth in @doxlabs/mcp/track — shared with the scaffolded sender workflow
// and the agent's branch producer so the two Track ingress paths can't drift.
/** Re-exported for back-compat with existing importers. */
export const PREVIEW_LABEL = DOCS_PREVIEW_LABEL
/** Non-merge actions that can (re)trigger a preview when the label is present. */
const PREVIEW_ACTIONS = new Set(['labeled', 'synchronize', 'opened', 'reopened'])

// ---------------------------------------------------------------------------
// Dox Track webhook logic — kept free of next/server so it unit-tests cleanly.
// The route (src/app/api/track/webhook/route.ts) is a thin shell around this.
//
// Track acts on MERGED pull requests, not raw commits: a merged PR is completed,
// reviewed work, whereas a commit can be undone by the next one.
// ---------------------------------------------------------------------------

// Display keys (`owner/repo@branch` → last merged PR) — bounded, one per repo,
// listed by the admin Tasks page.
const STATE_NS = 'track_state'
// Per-PR / per-preview-sha dedupe keys — these grow with PR history, so they live
// in a SEPARATE namespace that is only ever point-read by exact key, never
// kvList'd into memory (the Tasks page must not scan them on every render).
const DEDUPE_NS = 'track_dedupe'

/**
 * Verify GitHub's `x-hub-signature-256` header against the RAW request body.
 * The HMAC must be computed over the exact bytes GitHub sent — re-serialized
 * JSON never matches.
 */
export function verifyGithubSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on length mismatch — check first.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

interface PullRequestPayload {
  action?: string
  pull_request?: {
    number?: number
    title?: string
    html_url?: string
    merged?: boolean
    base?: { ref?: string }
    head?: { ref?: string; sha?: string }
    user?: { login?: string }
    labels?: Array<{ name?: string }>
  }
  repository?: { full_name?: string }
}

export interface PrMatch {
  repo: TrackingRepoConfig
  branch: string
  number: number
  htmlUrl: string
  requester?: string
  /** 'merged' — the PR landed; 'preview' — an open, `docs-preview`-labelled PR. */
  mode: 'merged' | 'preview'
  /** Head commit SHA — used to dedupe preview re-runs (present in preview mode). */
  headSha?: string
}

/**
 * Match a GitHub `pull_request` payload against the tracking config. Returns
 * null unless the PR either MERGED into the tracked base branch, OR is an open
 * PR labelled `docs-preview` on that base branch. Unmerged closes, wrong base,
 * untracked repos, and the docs agent's own `dox/agent-*` branches are ignored.
 * (Path filtering needs the PR's file list, which the payload omits — that
 * happens in processPullRequest.)
 */
export function matchPullRequestEvent(payload: unknown, tracking: TrackingConfig): PrMatch | null {
  const event = payload as PullRequestPayload
  const pr = event.pull_request
  if (!pr || typeof pr.number !== 'number' || !pr.html_url) return null

  // Loop guard: never react to the docs agent's own PRs (a self-tracking repo
  // would otherwise chase its own merged docs PRs forever).
  if (pr.head?.ref?.startsWith(AGENT_BRANCH_PREFIX)) return null

  const base = pr.base?.ref
  const fullName = event.repository?.full_name?.toLowerCase()
  if (!base || !fullName) return null

  const repo = tracking.repos.find(
    (r) => `${r.owner}/${r.repo}`.toLowerCase() === fullName && (r.branch ?? 'main') === base,
  )
  if (!repo) return null

  const merged = event.action === 'closed' && pr.merged === true
  const isPreview =
    !merged &&
    pr.merged !== true &&
    PREVIEW_ACTIONS.has(event.action ?? '') &&
    (pr.labels ?? []).some((l) => l.name === DOCS_PREVIEW_LABEL)

  if (!merged && !isPreview) return null

  return {
    repo,
    branch: base,
    number: pr.number,
    htmlUrl: pr.html_url,
    requester: pr.user?.login,
    mode: merged ? 'merged' : 'preview',
    headSha: isPreview ? pr.head?.sha : undefined,
  }
}

export interface ProcessPrDeps {
  storage: Pick<StorageAdapter, 'kvGet' | 'kvSet'>
  /** The docs repo the dispatch goes to, as owner/repo — null disables the relay. */
  docsRepo: string | null
  token?: string
  /** GitHub App creds (decrypted from admin settings) — preferred over env/PAT. */
  appCreds?: GithubAppCreds
  fetchImpl?: typeof fetch
}

export interface ProcessPrResult {
  status: 'noop' | 'dispatched'
  reason?: string
}

/**
 * Turn a matched merged PR into a `repository_dispatch` to the docs repo:
 * dedupe by PR number, apply the path filter (fetching the PR's files), build
 * the instruction, and dispatch `from_pr` so the docs-repo Action drafts the
 * documentation PR. Every failure short of a bug returns a noop with a reason —
 * the route never 5xxes at GitHub (flaky hooks get auto-disabled).
 */
export async function processPullRequest(match: PrMatch, deps: ProcessPrDeps): Promise<ProcessPrResult> {
  const { repo, branch, number, mode } = match

  // Merged PRs dedupe once per PR (redelivery = no-op). Preview PRs dedupe per
  // head sha so a fresh push re-drafts the preview docs, but the same push
  // redelivered stays a no-op.
  const dedupeKey =
    mode === 'preview'
      ? `${repo.owner}/${repo.repo}#${number}@${match.headSha ?? 'head'}`.toLowerCase()
      : `${repo.owner}/${repo.repo}#${number}`.toLowerCase()

  const seen = await deps.storage.kvGet<string>(DEDUPE_NS, dedupeKey)
  if (seen) return { status: 'noop', reason: 'already_synced' }

  if (!deps.docsRepo) return { status: 'noop', reason: 'no_docs_repo_configured' }
  const token = await resolveGithubToken({ token: deps.token, appCreds: deps.appCreds, fetchImpl: deps.fetchImpl })
  if (!token) return { status: 'noop', reason: 'no_github_token' }

  // Path filter (only when configured): the PR must touch a tracked path. If the
  // file fetch hiccups, dispatch anyway — the docs-repo Action rebuilds context.
  if (repo.paths?.length) {
    try {
      const files = await fetchPullRequestFiles(repo.owner, repo.repo, number, { token, fetchImpl: deps.fetchImpl })
      if (filterFilesByGlobs(files, repo.paths).length === 0) {
        return { status: 'noop', reason: 'no_tracked_paths_in_pr' }
      }
    } catch {
      // fall through and dispatch — better a possibly-irrelevant task than a miss
    }
  }

  const instruction = buildTrackInstruction(repo, { number }, { preview: mode === 'preview' })
  const fetchImpl = deps.fetchImpl ?? fetch
  const response = await fetchImpl(`https://api.github.com/repos/${deps.docsRepo}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'dox-document',
      client_payload: {
        instruction,
        from_pr: match.htmlUrl,
        preview: mode === 'preview',
        ...(match.requester ? { requester: match.requester } : {}),
      },
    }),
  })
  if (!response.ok) return { status: 'noop', reason: `dispatch_failed_${response.status}` }

  // Record only AFTER a successful dispatch (a failed dispatch stays un-recorded
  // so GitHub redelivery retries it). At-most-once *dispatch* per key — dedupes
  // GitHub redeliveries; it does not track whether the docs-repo Action then
  // succeeded. Re-run that from the docs repo's Actions tab if it fails.
  await deps.storage.kvSet(DEDUPE_NS, dedupeKey, match.htmlUrl)
  // Display key for the admin panel: the last *merged* PR synced on this base
  // branch. Previews are transient (they re-fire per push) — they must not
  // overwrite the "last synced" status or an open PR would read as synced.
  if (mode === 'merged') {
    await deps.storage.kvSet(STATE_NS, `${repo.owner}/${repo.repo}@${branch}`.toLowerCase(), `#${number}`)
  }
  return { status: 'dispatched' }
}
