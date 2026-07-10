import { z } from 'zod'
import { readDocsJson } from '../lib/docs-json.js'
import {
  parseOwnerRepo,
  fetchPullRequest,
  fetchPullRequestFiles,
  fetchLatestMergedPr,
  filterFilesByGlobs,
  buildTrackTask,
  resolveGithubToken,
  type TrackedRepoLike,
} from '../lib/track.js'

export const syncFromRepoSchema = z.object({
  projectDir: z.string().describe('Path to the Dox project (reads the tracking config from docs.json)'),
  repo: z
    .string()
    .optional()
    .describe('Tracked repo to sync as owner/repo (defaults to the single tracked repo when only one is configured)'),
  pr: z
    .number()
    .optional()
    .describe('Pull request number to analyze (defaults to the latest PR merged into the tracked base branch)'),
  dryRun: z
    .boolean()
    .optional()
    .default(true)
    .describe('When true (default), preview the distilled docs task without dispatching anything'),
  docsRepo: z
    .string()
    .optional()
    .describe('owner/repo of the docs repository to dispatch the task to (required when dryRun is false)'),
})

export type SyncFromRepoInput = z.infer<typeof syncFromRepoSchema>

/**
 * Analyze a MERGED pull request in a tracked product repo and either preview the
 * docs task it would produce (dryRun) or dispatch it to the docs repo's agent
 * workflow via `repository_dispatch`. The dispatch payload stays tiny — the
 * docs-repo Action rebuilds the full context from `from_pr`.
 */
export async function handleSyncFromRepo(input: SyncFromRepoInput): Promise<string> {
  const config = readDocsJson(input.projectDir)
  const tracked = config.tracking?.repos ?? []

  let target: TrackedRepoLike | undefined
  if (input.repo) {
    const ref = parseOwnerRepo(input.repo)
    if (!ref) throw new Error(`Invalid repo "${input.repo}" — expected owner/repo`)
    target =
      tracked.find(
        (r) => r.owner.toLowerCase() === ref.owner.toLowerCase() && r.repo.toLowerCase() === ref.repo.toLowerCase(),
      ) ?? { owner: ref.owner, repo: ref.repo }
  } else if (tracked.length === 1) {
    target = tracked[0]
  }
  if (!target) {
    throw new Error(
      tracked.length === 0
        ? 'No tracked repos in docs.json — add one with `dox track add <owner/repo>` or pass `repo`.'
        : `Multiple tracked repos configured — pass \`repo\` (one of: ${tracked.map((r) => `${r.owner}/${r.repo}`).join(', ')}).`,
    )
  }

  const branch = target.branch ?? 'main'
  const pr = input.pr
    ? await fetchPullRequest(target.owner, target.repo, input.pr)
    : await fetchLatestMergedPr(target.owner, target.repo, branch)
  if (!pr) {
    return `No merged pull requests found on ${target.owner}/${target.repo}@${branch}.`
  }

  const files = await fetchPullRequestFiles(target.owner, target.repo, pr.number)
  const matched = filterFilesByGlobs(files, target.paths)
  if (matched.length === 0) {
    return `PR ${target.owner}/${target.repo}#${pr.number} touches no tracked paths (${target.paths?.join(', ') ?? 'all'}) — nothing to document.`
  }

  const task = buildTrackTask(target, pr, matched)

  if (input.dryRun) {
    return [
      `🔍 Dry run — docs task for ${target.owner}/${target.repo}#${pr.number}`,
      '',
      `PR: ${pr.title}`,
      `Files matched: ${matched.length} of ${files.length} (${matched.map((f) => f.filename).slice(0, 10).join(', ')}${matched.length > 10 ? ', …' : ''})`,
      '',
      `Instruction: ${task.instruction}`,
      '',
      'Context head:',
      task.context.slice(0, 1500),
      '',
      'Run again with dryRun: false and a docsRepo to dispatch this task to the docs-agent workflow.',
    ].join('\n')
  }

  if (!input.docsRepo) throw new Error('docsRepo (owner/repo of the docs repository) is required when dryRun is false.')
  const docsRef = parseOwnerRepo(input.docsRepo)
  if (!docsRef) throw new Error(`Invalid docsRepo "${input.docsRepo}" — expected owner/repo`)

  const token = await resolveGithubToken()
  if (!token) {
    throw new Error('Set DOX_GITHUB_TOKEN (or connect a GitHub App) with dispatch access to the docs repo to dispatch a docs task.')
  }

  const response = await fetch(`https://api.github.com/repos/${docsRef.owner}/${docsRef.repo}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'dox-document',
      client_payload: { instruction: task.instruction, from_pr: pr.htmlUrl },
    }),
  })
  if (!response.ok) {
    throw new Error(`repository_dispatch failed (${response.status}) — check the token's access to ${input.docsRepo}.`)
  }

  return `✅ Dispatched docs task for ${target.owner}/${target.repo}#${pr.number} to ${input.docsRepo}. The "Dox docs agent" workflow there will draft the PR — watch its Actions tab.`
}
