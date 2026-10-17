import { execFileSync } from 'node:child_process'
import {
  buildTrackContext,
  createTrackClient,
  envGitHosts,
  filterFilesByGlobs,
  isTrackOwnedBranch,
  parseRepositoryReference,
  resolveGitHosts,
  type GitHostConfig,
  type PullRequestInfo,
  type TrackClient,
} from '@thallylabs/mcp/track'

/** Resolve a git ref (e.g. `HEAD~1`, a SHA, `main`) into a unified diff. */
export function resolveDiff(projectDir: string, ref: string): string {
  for (const args of [['diff', `${ref}...HEAD`], ['diff', ref]]) {
    try {
      const out = execFileSync('git', args, { cwd: projectDir, encoding: 'utf8' })
      if (out.trim()) return out.slice(0, 20000)
    } catch {
      // try the next form
    }
  }
  return ''
}

/**
 * Thrown when a GitLab merge commit belongs to a Track-authored merge request.
 * GitLab push pipelines cannot see the source branch, so the receiver applies
 * the loop guard here; callers treat it as "nothing to do", not a failure.
 */
export class TrackOwnedChangeError extends Error {
  constructor(public readonly sourceRef: string) {
    super(`Skipping a Track-authored change (source branch ${sourceRef}).`)
    this.name = 'TrackOwnedChangeError'
  }
}

/** Options for {@link resolvePrContext}. */
export interface ResolvePrContextOptions {
  /** Injectable for tests (GitLab only; GitHub uses the gh CLI). */
  fetchImpl?: typeof fetch
  /** Extra self-hosted hosts; `THALLY_GIT_HOSTS` and the GitLab CI server are always included. */
  hosts?: ReadonlyArray<GitHostConfig>
}

const COMMIT_PATH = /\/-\/commit\/([0-9a-f]{7,64})(?:[/?#]|$)/i

async function resolveGitlabRequest(client: TrackClient, url: string, number?: number): Promise<PullRequestInfo> {
  if (number !== undefined) return client.fetchPullRequest(number)
  const sha = COMMIT_PATH.exec(url)?.[1]
  if (!sha) throw new Error(`Not a GitLab merge request or commit URL: ${url}`)
  const requests = await client.fetchPullRequestsForCommit(sha)
  const merged = requests.find((request) => request.mergedAt) ?? requests[0]
  if (!merged) throw new Error(`No merge request introduced commit ${sha.slice(0, 12)}.`)
  return merged
}

/**
 * Resolve a product change into markdown context for the agent.
 *
 * - GitHub pull requests use the `gh` CLI (unchanged; needs gh auth).
 * - GitLab merge requests (`.../-/merge_requests/N`) and merge commits
 *   (`.../-/commit/<sha>`, sent by push-triggered GitLab senders) use the
 *   GitLab API with `THALLY_GITLAB_TOKEN`. A commit whose merge request came
 *   from a Track-owned branch throws {@link TrackOwnedChangeError}.
 */
export async function resolvePrContext(prUrl: string, options: ResolvePrContextOptions = {}): Promise<string> {
  const hosts = resolveGitHosts([...envGitHosts(), ...(options.hosts ?? [])])
  const ref = parseRepositoryReference(prUrl, { hosts })
  if (ref?.provider === 'gitlab') {
    const client = createTrackClient(ref, { fetchImpl: options.fetchImpl })
    const request = await resolveGitlabRequest(client, prUrl, ref.number)
    if (isTrackOwnedBranch(request.sourceRef)) throw new TrackOwnedChangeError(request.sourceRef ?? '')
    const files = filterFilesByGlobs(await client.fetchPullRequestFiles(request.number))
    return buildTrackContext(ref, request, files)
  }

  let pr: { title: string; body: string; number: number; url: string }
  try {
    const json = execFileSync('gh', ['pr', 'view', prUrl, '--json', 'title,body,number,url'], { encoding: 'utf8' })
    pr = JSON.parse(json)
  } catch (err) {
    throw new Error(`Could not read the PR via gh (is it installed and authenticated?): ${err instanceof Error ? err.message : String(err)}`)
  }

  let diff = ''
  try {
    diff = execFileSync('gh', ['pr', 'diff', prUrl], { encoding: 'utf8' }).slice(0, 20000)
  } catch {
    // diff is best-effort
  }

  return [
    `# Product PR #${pr.number}: ${pr.title}`,
    `URL: ${pr.url}`,
    '',
    pr.body?.trim() || '(no description)',
    diff ? `\n## Diff\n\`\`\`diff\n${diff}\n\`\`\`` : '',
  ].join('\n')
}
