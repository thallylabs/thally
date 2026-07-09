import { createHmac, timingSafeEqual } from 'node:crypto'
import { fetchCommit, fetchCompare, filterFilesByGlobs, buildTrackTask } from '@doxlabs/mcp/track'
import type { TrackingConfig, TrackingRepoConfig } from '@/data/docs'
import type { StorageAdapter } from '@/lib/storage/types'

// ---------------------------------------------------------------------------
// Dox Track webhook logic — kept free of next/server so it unit-tests cleanly.
// The route (src/app/api/track/webhook/route.ts) is a thin shell around this.
// ---------------------------------------------------------------------------

const ZERO_SHA = '0'.repeat(40)
const STATE_NS = 'track_state'

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

interface PushPayload {
  ref?: string
  before?: string
  after?: string
  deleted?: boolean
  repository?: { full_name?: string }
  pusher?: { name?: string }
  head_commit?: { added?: Array<string>; removed?: Array<string>; modified?: Array<string> } | null
  commits?: Array<{ added?: Array<string>; removed?: Array<string>; modified?: Array<string> }>
}

export interface PushMatch {
  repo: TrackingRepoConfig
  branch: string
  before: string
  after: string
  requester?: string
  matchedFiles: Array<string>
}

/**
 * Match a GitHub push payload against the tracking config. Returns null for
 * anything that shouldn't produce a docs task: tag pushes, branch deletions,
 * untracked repos/branches, or commits touching none of the tracked paths.
 */
export function matchPushEvent(payload: unknown, tracking: TrackingConfig): PushMatch | null {
  const push = payload as PushPayload
  const ref = push?.ref
  if (typeof ref !== 'string' || !ref.startsWith('refs/heads/')) return null
  if (push.deleted === true || !push.after || push.after === ZERO_SHA) return null

  const branch = ref.slice('refs/heads/'.length)
  const fullName = push.repository?.full_name?.toLowerCase()
  if (!fullName) return null

  const repo = tracking.repos.find(
    (r) => `${r.owner}/${r.repo}`.toLowerCase() === fullName && (r.branch ?? 'main') === branch,
  )
  if (!repo) return null

  // Path filter across ALL commits in the push (head_commit alone misses files
  // from earlier commits); fall back to head_commit on force-push payloads.
  const commits = push.commits?.length ? push.commits : push.head_commit ? [push.head_commit] : []
  const touched = new Set<string>()
  for (const commit of commits) {
    for (const file of [...(commit.added ?? []), ...(commit.removed ?? []), ...(commit.modified ?? [])]) {
      touched.add(file)
    }
  }
  const matchedFiles = filterFilesByGlobs(
    Array.from(touched).map((filename) => ({ filename })),
    repo.paths,
  ).map((f) => f.filename)
  if (repo.paths?.length && matchedFiles.length === 0) return null

  return {
    repo,
    branch,
    before: push.before ?? ZERO_SHA,
    after: push.after,
    requester: push.pusher?.name,
    matchedFiles,
  }
}

export interface ProcessPushDeps {
  storage: Pick<StorageAdapter, 'kvGet' | 'kvSet'>
  /** The docs repo the dispatch goes to, as owner/repo — null disables the relay. */
  docsRepo: string | null
  token?: string
  fetchImpl?: typeof fetch
}

export interface ProcessPushResult {
  status: 'noop' | 'dispatched'
  reason?: string
}

/**
 * Turn a matched push into a `repository_dispatch` to the docs repo: dedupe by
 * last-seen SHA, distill the push range into an instruction, dispatch, then
 * record the SHA. Every failure short of a bug returns a noop with a reason —
 * the route never 5xxes at GitHub (flaky hooks get auto-disabled).
 */
export async function processPush(match: PushMatch, deps: ProcessPushDeps): Promise<ProcessPushResult> {
  const { repo, branch, before, after } = match
  const stateKey = `${repo.owner}/${repo.repo}@${branch}`.toLowerCase()

  const lastSeen = await deps.storage.kvGet<string>(STATE_NS, stateKey)
  if (lastSeen === after) return { status: 'noop', reason: 'already_synced' }

  if (!deps.docsRepo) return { status: 'noop', reason: 'no_docs_repo_configured' }
  const token = deps.token ?? process.env.DOX_GITHUB_TOKEN ?? process.env.DOX_TASKS_TOKEN
  if (!token) return { status: 'noop', reason: 'no_github_token' }

  // Distill the whole push range when we have a real `before`; a single commit
  // (or force-push) falls back to the head commit alone.
  const fetchOptions = { token, fetchImpl: deps.fetchImpl }
  let instruction: string
  try {
    const info =
      before && before !== ZERO_SHA
        ? await fetchCompare(repo.owner, repo.repo, before, after, fetchOptions)
        : await fetchCommit(repo.owner, repo.repo, after, fetchOptions)
    const matched = filterFilesByGlobs(info.files, repo.paths)
    if (repo.paths?.length && matched.length === 0) return { status: 'noop', reason: 'no_tracked_paths_in_diff' }
    instruction = buildTrackTask(repo, { ...info, files: matched, sha: after }).instruction
  } catch {
    // API hiccup — still dispatch; the docs-repo Action rebuilds context itself.
    instruction = `Update the documentation for commit ${repo.owner}/${repo.repo}@${after.slice(0, 7)}.`
  }

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
        from_commit: `${repo.owner}/${repo.repo}@${after}`,
        ...(match.requester ? { requester: match.requester } : {}),
      },
    }),
  })
  if (!response.ok) return { status: 'noop', reason: `dispatch_failed_${response.status}` }

  // Record the SHA only AFTER a successful dispatch — a failed dispatch stays
  // un-recorded so GitHub's redelivery retries it. This is at-most-once
  // *dispatch* (dedupes GitHub redeliveries of the same push); it does not
  // track whether the docs-repo Action then succeeded. If that Action fails,
  // re-run it from the docs repo's Actions tab (workflow_dispatch) with the
  // from_commit input — re-dispatching the same push here is a deliberate no-op.
  await deps.storage.kvSet(STATE_NS, stateKey, after)
  return { status: 'dispatched' }
}
