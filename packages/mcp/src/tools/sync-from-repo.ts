import { z } from 'zod'
import {
  parseRepositoryReference,
  readGitHostsConfig,
  resolveGitHosts,
  type GitHostConfig,
  type RepositoryRef,
} from '@thallylabs/core/repository'
import {
  describeTrackedRepo,
  trackedRepoKey,
  trackedRepoRef,
  type TrackedRepoConfig,
} from '@thallylabs/core/tracking'
import { readDocsJson } from '../lib/docs-json.js'
import { buildTrackTask, createTrackClient, envGitHosts, filterFilesByGlobs } from '../lib/track.js'

export const syncFromRepoSchema = z.object({
  projectDir: z.string().describe('Path to the Thally project (reads the tracking config from docs.json)'),
  repo: z
    .string()
    .optional()
    .describe(
      'Tracked repo to sync: owner/repo (GitHub), group/subgroup/project (GitLab), or a repository URL. Defaults to the single tracked repo when only one is configured',
    ),
  provider: z
    .enum(['github', 'gitlab'])
    .optional()
    .describe('Provider for a bare `repo` / `docsRepo` spec (default github for owner/repo, gitlab for deeper paths)'),
  host: z.string().optional().describe('Self-hosted hostname for a bare `repo` / `docsRepo` spec'),
  pr: z
    .number()
    .optional()
    .describe('Pull/merge request number to analyze (defaults to the latest one merged into the tracked base branch)'),
  dryRun: z
    .boolean()
    .optional()
    .default(true)
    .describe('When true (default), preview the distilled docs task without dispatching anything'),
  docsRepo: z
    .string()
    .optional()
    .describe('Docs repository to dispatch the task to (owner/repo, group/project, or URL; required when dryRun is false)'),
  docsRef: z
    .string()
    .optional()
    .describe('Docs branch the GitLab pipeline runs on (default main; GitHub dispatch ignores it)'),
})

export type SyncFromRepoInput = z.infer<typeof syncFromRepoSchema>

/** Injectable dependencies for tests. */
export interface SyncFromRepoDeps {
  fetchImpl?: typeof fetch
}

function knownHosts(docsJson: unknown): Array<GitHostConfig> {
  return [...readGitHostsConfig(docsJson), ...envGitHosts()]
}

function parseSpec(
  spec: string,
  input: SyncFromRepoInput,
  hosts: Array<GitHostConfig>,
  label: string,
): RepositoryRef {
  const ref = parseRepositoryReference(spec, {
    hosts: resolveGitHosts(hosts),
    provider: input.provider,
    host: input.host,
  })
  if (!ref) {
    throw new Error(`Invalid ${label} "${spec}" — expected owner/repo, group/subgroup/project, or a repository URL`)
  }
  return ref
}

/**
 * Analyze a MERGED pull/merge request in a tracked product repo and either
 * preview the docs task it would produce (dryRun) or dispatch it to the docs
 * repository: `repository_dispatch` on GitHub, a pipeline trigger on GitLab.
 * The dispatch payload stays tiny — the docs-side agent rebuilds the full
 * context from `from_pr`.
 */
export async function handleSyncFromRepo(input: SyncFromRepoInput, deps: SyncFromRepoDeps = {}): Promise<string> {
  const config = readDocsJson(input.projectDir)
  const hosts = knownHosts(config)
  const tracked: Array<TrackedRepoConfig> = config.tracking?.repos ?? []

  let target: TrackedRepoConfig | undefined
  if (input.repo) {
    const ref = parseSpec(input.repo, input, hosts, 'repo')
    const candidate: TrackedRepoConfig = { owner: ref.owner, repo: ref.repo, provider: ref.provider, host: ref.host }
    const key = trackedRepoKey(candidate, hosts)
    target = tracked.find((r) => trackedRepoKey(r, hosts) === key) ?? candidate
  } else if (tracked.length === 1) {
    target = tracked[0]
  }
  if (!target) {
    throw new Error(
      tracked.length === 0
        ? 'No tracked repos in docs.json — add one with `thally track add <owner/repo>` or pass `repo`.'
        : `Multiple tracked repos configured — pass \`repo\` (one of: ${tracked.map((r) => describeTrackedRepo(r, hosts)).join(', ')}).`,
    )
  }

  const client = createTrackClient(trackedRepoRef(target, hosts), { fetchImpl: deps.fetchImpl })
  const name = `${target.owner}/${target.repo}`
  const branch = target.branch ?? 'main'
  const pr = input.pr ? await client.fetchPullRequest(input.pr) : await client.fetchLatestMergedPr(branch)
  if (!pr) {
    return `No merged ${client.provider === 'gitlab' ? 'merge' : 'pull'} requests found on ${name}@${branch}.`
  }

  const label = `${name}${client.label(pr.number)}`
  const files = await client.fetchPullRequestFiles(pr.number)
  const matched = filterFilesByGlobs(files, target.paths)
  if (matched.length === 0) {
    return `${client.provider === 'gitlab' ? 'MR' : 'PR'} ${label} touches no tracked paths (${target.paths?.join(', ') ?? 'all'}) — nothing to document.`
  }

  const task = buildTrackTask(target, pr, matched)

  if (input.dryRun) {
    return [
      `🔍 Dry run — docs task for ${label}`,
      '',
      `${client.provider === 'gitlab' ? 'MR' : 'PR'}: ${pr.title}`,
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

  if (!input.docsRepo) throw new Error('docsRepo (the docs repository) is required when dryRun is false.')
  const docsRef = parseSpec(input.docsRepo, input, hosts, 'docsRepo')
  const dispatcher = createTrackClient(docsRef, { fetchImpl: deps.fetchImpl })
  await dispatcher.dispatchDocsTask(docsRef, {
    event: 'thally-document',
    instruction: task.instruction,
    fromPr: pr.htmlUrl,
    ref: input.docsRef,
  })

  return docsRef.provider === 'gitlab'
    ? `✅ Dispatched docs task for ${label} to ${docsRef.fullPath}. The "thally-document" job in its pipeline will draft the merge request — watch Build › Pipelines.`
    : `✅ Dispatched docs task for ${label} to ${input.docsRepo}. The "Thally docs agent" workflow there will draft the PR — watch its Actions tab.`
}
