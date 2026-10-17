import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type { ParsedArgs } from '../router.js'
import {
  buildTrackTask,
  createTrackClient,
  describeTrackedRepo,
  envGitHosts,
  filterFilesByGlobs,
  parseRepositoryReference,
  readGitHostsConfig,
  resolveGitHosts,
  trackedRepoEntry,
  trackedRepoKey,
  trackedRepoRef,
  type GitHostConfig,
  type GitProvider,
  type RepositoryRef,
  type TrackedRepoConfig,
} from '@thallylabs/mcp/track'
import { runAgent, trackSenderGitlabJobs, trackSenderWorkflow, type AnthropicLike } from '@thallylabs/agent'

type TrackedRepo = TrackedRepoConfig

// Thin docs.json round-trip, typed for the tracking block only. JSON.parse keeps
// every other key intact, so writing back never drops config.
interface DocsJsonWithTracking {
  tracking?: { repos?: Array<TrackedRepo> }
  [key: string]: unknown
}

function readDocsJson(projectDir: string): DocsJsonWithTracking {
  return JSON.parse(readFileSync(join(projectDir, 'docs.json'), 'utf8')) as DocsJsonWithTracking
}

function writeDocsJson(projectDir: string, config: DocsJsonWithTracking): void {
  writeFileSync(join(projectDir, 'docs.json'), JSON.stringify(config, null, 2) + '\n', 'utf8')
}

function trackedRepos(projectDir: string): Array<TrackedRepo> {
  return readDocsJson(projectDir).tracking?.repos ?? []
}

/** Self-hosted hosts from docs.json `repository.hosts`, `THALLY_GIT_HOSTS`, and GitLab CI. */
function knownHosts(projectDir: string): Array<GitHostConfig> {
  let fromDocs: Array<GitHostConfig> = []
  try {
    fromDocs = readGitHostsConfig(readDocsJson(projectDir))
  } catch {
    // No docs.json yet: environment declarations still apply.
  }
  return [...fromDocs, ...envGitHosts()]
}

/** Read and validate `--provider`; null means an invalid value. */
function providerFlag(args: ParsedArgs): GitProvider | undefined | null {
  const value = args.getFlag('--provider')?.trim().toLowerCase()
  if (value === undefined) return undefined
  return value === 'github' || value === 'gitlab' ? value : null
}

/** Parse a repo spec with --provider/--host applied. */
function parseRepoArg(spec: string, args: ParsedArgs, hosts: Array<GitHostConfig>): RepositoryRef | null {
  const provider = providerFlag(args)
  if (provider === null) return null
  return parseRepositoryReference(spec, {
    hosts: resolveGitHosts(hosts),
    provider,
    host: args.getFlag('--host'),
    ...(provider ? { fallbackProvider: provider } : {}),
  })
}

function describeRepo(repo: TrackedRepo, hosts: Array<GitHostConfig>): string {
  const globs = repo.paths?.length ? `  paths: ${repo.paths.join(', ')}` : '  paths: (all files)'
  const output = repo.outputTab ? `  → "${repo.outputTab}"${repo.outputGroup ? ` / "${repo.outputGroup}"` : ''}` : ''
  return `  • ${describeTrackedRepo(repo, hosts)}@${repo.branch ?? 'main'}\n  ${globs}${output ? `\n  ${output}` : ''}`
}

const ADD_USAGE =
  '\n  ❌ Usage: thally track add <owner/repo | group/subgroup/project | repository URL> [--provider github|gitlab] [--host <host>] [--branch <b>] [--paths <globs,csv>] [--tab <tab>] [--group <group>]\n\n'

function runTrackAdd(args: ParsedArgs): number {
  const projectDir = process.cwd()
  const hosts = knownHosts(projectDir)
  const spec = args.positionals[1]
  const ref = spec ? parseRepoArg(spec, args, hosts) : null
  if (!ref) {
    process.stderr.write(ADD_USAGE)
    return 1
  }

  const config = readDocsJson(projectDir)
  const repos = config.tracking?.repos ?? []

  const entry: TrackedRepo = trackedRepoEntry(ref, {
    ...(args.getFlag('--branch') ? { branch: args.getFlag('--branch') } : {}),
    ...(args.getFlag('--paths') ? { paths: args.getFlag('--paths')!.split(',').map((p) => p.trim()).filter(Boolean) } : {}),
    ...(args.getFlag('--tab') ? { outputTab: args.getFlag('--tab') } : {}),
    ...(args.getFlag('--group') ? { outputGroup: args.getFlag('--group') } : {}),
  })

  // Upsert — one entry per provider/host/owner/repo@branch.
  const key = (r: TrackedRepo) => `${trackedRepoKey(r, hosts)}@${r.branch ?? 'main'}`.toLowerCase()
  const existing = repos.findIndex((r) => key(r) === key(entry))
  if (existing !== -1) repos[existing] = entry
  else repos.push(entry)

  config.tracking = { repos }
  writeDocsJson(projectDir, config)

  process.stdout.write(`\n  ✓ ${existing !== -1 ? 'Updated' : 'Added'} tracked repo in docs.json:\n\n${describeRepo(entry, hosts)}\n`)
  process.stdout.write('\n  Next: run "thally track setup" to wire the trigger.\n\n')
  return 0
}

function runTrackList(): number {
  const projectDir = process.cwd()
  const repos = trackedRepos(projectDir)
  if (repos.length === 0) {
    process.stdout.write('\n  No tracked repos yet. Add one with:\n\n    thally track add <owner/repo> --paths "src/**,openapi.yaml"\n\n')
    return 0
  }
  const hosts = knownHosts(projectDir)
  process.stdout.write(`\n  🔗 Tracked repos (${repos.length})\n\n`)
  for (const repo of repos) process.stdout.write(`${describeRepo(repo, hosts)}\n\n`)
  return 0
}

/** Resolve which tracked repo a subcommand targets (arg, or the only entry). */
function resolveTarget(args: ParsedArgs, hosts: Array<GitHostConfig>): TrackedRepo | null {
  const repos = trackedRepos(process.cwd())
  const spec = args.positionals[1]
  if (spec) {
    const ref = parseRepoArg(spec, args, hosts)
    if (!ref) return null
    const candidate = trackedRepoEntry(ref)
    const key = trackedRepoKey(candidate, hosts)
    // Allow testing a repo that isn't registered yet — use the bare ref.
    return repos.find((r) => trackedRepoKey(r, hosts) === key) ?? candidate
  }
  if (repos.length === 1) return repos[0]
  return null
}

async function runTrackTest(args: ParsedArgs): Promise<number> {
  const hosts = knownHosts(process.cwd())
  const target = resolveTarget(args, hosts)
  if (!target) {
    process.stderr.write('\n  ❌ Usage: thally track test <owner/repo | group/project | URL> [--pr <number>] [--provider github|gitlab] [--host <host>]\n     (the repo argument is optional when exactly one repo is tracked)\n\n')
    return 1
  }

  const trackClient = createTrackClient(trackedRepoRef(target, hosts))
  const name = `${target.owner}/${target.repo}`
  const requestNoun = trackClient.provider === 'gitlab' ? 'MR' : 'PR'
  process.stdout.write(`\n  🧪 Thally Track — dry run for ${describeTrackedRepo(target, hosts)}\n\n`)

  const branch = target.branch ?? 'main'
  try {
    // A specific request (--pr), else the latest one merged into the tracked base branch.
    const prArg = args.getFlag('--pr')
    const pr = prArg ? await trackClient.fetchPullRequest(Number(prArg)) : await trackClient.fetchLatestMergedPr(branch)
    if (!pr) {
      process.stdout.write(`\n  No merged ${trackClient.provider === 'gitlab' ? 'merge' : 'pull'} requests found on ${name}@${branch}.\n\n`)
      return 0
    }

    const files = await trackClient.fetchPullRequestFiles(pr.number)
    const matched = filterFilesByGlobs(files, target.paths)
    if (matched.length === 0) {
      process.stdout.write(`\n  ${requestNoun} ${trackClient.label(pr.number)} touches no tracked paths (${target.paths?.join(', ') ?? 'all'}) — nothing to document.\n\n`)
      return 0
    }

    const task = buildTrackTask(target, pr, matched)
    process.stdout.write(`\n  ${requestNoun}:      ${trackClient.label(pr.number)} — ${pr.title}\n`)
    process.stdout.write(`  Files:   ${matched.length} matched (of ${files.length})\n`)
    process.stdout.write(`\n  Task instruction:\n    ${task.instruction}\n`)
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
    if (!apiKey) {
      process.stdout.write(`\n  Context preview (first 2000 chars):\n\n${task.context.slice(0, 2000)}\n`)
      process.stdout.write('\n  Set ANTHROPIC_API_KEY to run the docs agent dry-run and preview the actual doc edits.\n\n')
      return 0
    }

    const real = new Anthropic({ apiKey })
    const client: AnthropicLike = {
      messages: { create: (body) => real.messages.create(body as never) as never },
    }
    process.stdout.write('\n  🤖 Running the docs agent (dry run — nothing will be written)…\n\n')
    const result = await runAgent(
      client,
      { instruction: task.instruction, context: task.context, source: 'track' },
      {
        projectDir: process.cwd(),
        mode: 'dry-run',
        onEvent: (event) => process.stdout.write(`  ${event}\n`),
      },
    )
    if (result.noChanges) {
      process.stdout.write('\n  The agent decided no documentation changes were needed.\n\n')
      return 0
    }
    process.stdout.write(`\n  ${result.summary}\n\n${result.diff}\n  (dry run — nothing was written)\n\n`)
    return 0
  } catch (err) {
    process.stderr.write(`\n  ❌ ${err instanceof Error ? err.message : String(err)}\n\n`)
    return 1
  }
}

function printGithubSetup(repos: Array<TrackedRepo>, siteUrl: string, docsRepo: string, write: boolean): void {
  process.stdout.write('\n  ── GitHub — Mode A: Connect GitHub app  (recommended for orgs / many private repos)\n\n')
  process.stdout.write('    The app-install path — no token to paste, org-wide access to the\n')
  process.stdout.write('    repos you pick.\n\n')
  process.stdout.write(`    1. Open your admin dashboard → Settings → Integrations:  ${siteUrl}/admin/settings\n`)
  process.stdout.write('    2. Click "Connect GitHub" (enter your org to install it org-wide), create the\n')
  process.stdout.write('       app on GitHub, then choose which repos Thally Track may watch.\n')
  process.stdout.write('    3. Set THALLY_AUTH_SECRET on the deployed site first — it encrypts the app key.\n')
  process.stdout.write('       The app carries its own webhook, so no THALLY_TRACK_WEBHOOK_SECRET is needed.\n')

  process.stdout.write('\n  ── GitHub — Mode B: fine-grained PAT + webhook  (single repo, simplest to reason about)\n\n')
  process.stdout.write(`    1. Generate a secret:            openssl rand -hex 32\n`)
  process.stdout.write(`    2. Set it on the deployed site:  THALLY_TRACK_WEBHOOK_SECRET=<secret>\n`)
  process.stdout.write(`       …and set THALLY_GITHUB_TOKEN (a fine-grained PAT that reads tracked PRs +\n`)
  process.stdout.write(`       dispatches to the docs repo).\n`)
  process.stdout.write(`    3. In each tracked repo → Settings → Webhooks → Add webhook:\n`)
  process.stdout.write(`         Payload URL:   ${siteUrl}/api/track/webhook\n`)
  process.stdout.write(`         Content type:  application/json\n`)
  process.stdout.write(`         Secret:        <the same secret>\n`)
  process.stdout.write(`         Events:        Let me select — check "Pull requests"\n`)

  process.stdout.write('\n  ── GitHub — Mode C: sender workflow in the tracked repo  (no server in the loop)\n\n')
  if (repos.length === 0) {
    process.stdout.write('    (No tracked GitHub repos in docs.json yet — run "thally track add" first to generate\n     a paths-filtered workflow here.)\n')
    return
  }
  for (const repo of repos) {
    const yaml = trackSenderWorkflow(docsRepo, repo)
    process.stdout.write(`    For ${repo.owner}/${repo.repo} — add .github/workflows/thally-track.yml:\n\n`)
    process.stdout.write(yaml.split('\n').map((line) => `      ${line}`).join('\n'))
    process.stdout.write('\n')
    if (write) {
      const out = `thally-track-sender-${repo.repo}.yml`
      writeFileSync(join(process.cwd(), out), yaml)
      process.stdout.write(`    ✓ Wrote ${out} (copy it into ${repo.owner}/${repo.repo})\n\n`)
    }
  }
  process.stdout.write('    …and add a THALLY_DISPATCH_TOKEN secret in each tracked repo (dispatch access to the docs repo).\n')
}

function printGitlabSetup(
  repos: Array<TrackedRepo>,
  siteUrl: string,
  docsRef: RepositoryRef | null,
  write: boolean,
): void {
  process.stdout.write('\n  ── GitLab — Mode B: access token + webhook  (Thally Cloud or a self-hosted Track service)\n\n')
  process.stdout.write('    1. Generate a secret:            openssl rand -hex 32\n')
  process.stdout.write('    2. Set on the deployed site:     THALLY_TRACK_WEBHOOK_SECRET=<secret>\n')
  process.stdout.write('       …and THALLY_GITLAB_TOKEN (project/group access token, read_api on tracked\n')
  process.stdout.write('       projects) plus THALLY_GITLAB_TRIGGER_TOKEN (the docs project\'s pipeline\n')
  process.stdout.write('       trigger token). Self-hosted: declare the host in docs.json repository.hosts\n')
  process.stdout.write('       or THALLY_GIT_HOSTS=<host>=gitlab.\n')
  process.stdout.write('    3. In each tracked project → Settings → Webhooks → Add new webhook:\n')
  process.stdout.write(`         URL:           ${siteUrl}/api/track/webhook\n`)
  process.stdout.write('         Secret token:  <the same secret>\n')
  process.stdout.write('         Trigger:       Merge request events\n')

  process.stdout.write('\n  ── GitLab — Mode C: sender jobs in the tracked project  (no server in the loop)\n\n')
  if (!docsRef) {
    process.stdout.write('    Pass --repo <group/docs-project> (with --provider gitlab for a two-segment path)\n    to generate sender jobs that trigger your docs project\'s pipeline.\n')
    return
  }
  if (repos.length === 0) {
    process.stdout.write('    (No tracked GitLab projects in docs.json yet — run "thally track add" first.)\n')
    return
  }
  for (const repo of repos) {
    const yaml = trackSenderGitlabJobs(docsRef, repo)
    process.stdout.write(`    For ${repo.owner}/${repo.repo} — add to its .gitlab-ci.yml (or include a file):\n\n`)
    process.stdout.write(yaml.split('\n').map((line) => `      ${line}`).join('\n'))
    process.stdout.write('\n')
    if (write) {
      const out = `thally-track-sender-${repo.repo}.gitlab-ci.yml`
      writeFileSync(join(process.cwd(), out), yaml)
      process.stdout.write(`    ✓ Wrote ${out} (copy it into ${repo.owner}/${repo.repo})\n\n`)
    }
  }
  process.stdout.write(`    …and add a masked THALLY_DISPATCH_TOKEN variable in each tracked project\n    (a pipeline trigger token from ${docsRef.fullPath}).\n`)
}

function runTrackSetup(args: ParsedArgs): number {
  const projectDir = process.cwd()
  const hosts = knownHosts(projectDir)
  const repos = trackedRepos(projectDir)
  const resolved = repos.map((repo) => ({ repo, ref: trackedRepoRef(repo, hosts) }))
  const githubRepos = resolved.filter((entry) => entry.ref.provider === 'github').map((entry) => entry.repo)
  const gitlabRepos = resolved.filter((entry) => entry.ref.provider === 'gitlab').map((entry) => entry.repo)
  const siteUrl = (process.env.THALLY_SITE_URL ?? process.env.DOX_SITE_URL)?.trim().replace(/\/$/, '') ?? '<your-docs-site>'
  const docsSpec = args.getFlag('--repo')
  const docsRef = docsSpec ? parseRepoArg(docsSpec, args, hosts) : null
  const showGitlab = gitlabRepos.length > 0 || docsRef?.provider === 'gitlab' || providerFlag(args) === 'gitlab'
  const showGithub = githubRepos.length > 0 || !showGitlab

  process.stdout.write('\n  🔗 Thally Track — trigger setup\n')
  process.stdout.write('\n  Pick ONE access mode. Every mode ends in the same place: a dispatch to your\n')
  process.stdout.write('  docs repo, whose Thally docs agent pipeline drafts the docs PR or MR\n')
  process.stdout.write('  (run "thally agent init" there first if you haven\'t).\n')

  if (showGithub) {
    const githubDocsRepo = docsRef?.provider === 'github' ? docsRef.fullPath : docsSpec ?? '<owner>/<docs-repo>'
    printGithubSetup(githubRepos, siteUrl, githubDocsRepo, args.hasFlag('--write'))
  }
  if (showGitlab) {
    printGitlabSetup(gitlabRepos, siteUrl, docsRef?.provider === 'gitlab' ? docsRef : null, args.hasFlag('--write'))
  }

  process.stdout.write('\n  ── Preview docs before merge\n\n')
  process.stdout.write('    Add the "docs-preview" label to an OPEN pull or merge request (any mode above)\n')
  process.stdout.write('    to have the agent draft its docs while it\'s still in review — so reviewers see\n')
  process.stdout.write('    the docs alongside the code. The label re-drafts on each push; the docs land\n')
  process.stdout.write('    as a separate PR or MR.\n\n')
  return 0
}

/**
 * `thally track <add|list|test|setup>` — register product repos whose merged PRs
 * should become documentation PRs (Thally Track).
 */
export async function runTrackCommand(args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0]
  if (sub === 'add') return runTrackAdd(args)
  if (sub === 'list') return runTrackList()
  if (sub === 'test') return runTrackTest(args)
  if (sub === 'setup') return runTrackSetup(args)

  process.stdout.write('\n  Usage: thally track <subcommand> [options]\n\n')
  process.stdout.write('  Subcommands:\n')
  process.stdout.write('    add <repo>           Track a repo: owner/repo, group/project, or URL (--provider, --host, --branch, --paths csv, --tab, --group)\n')
  process.stdout.write('    list                 List tracked repos\n')
  process.stdout.write('    test [repo]          Dry run: distill the latest merged PR/MR, preview doc changes\n')
  process.stdout.write('    setup                Print access setup (GitHub app / tokens + webhook / sender workflow or jobs)\n\n')
  return sub ? 1 : 0
}
