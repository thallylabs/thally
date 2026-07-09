import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type { ParsedArgs } from '../router.js'
import {
  parseOwnerRepo,
  fetchCommit,
  filterFilesByGlobs,
  buildTrackTask,
  type TrackedRepoLike,
} from '@doxlabs/mcp/track'
import { runAgent, trackSenderWorkflow, type AnthropicLike } from '@doxlabs/agent'

interface TrackedRepo extends TrackedRepoLike {
  owner: string
  repo: string
}

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

function describeRepo(repo: TrackedRepo): string {
  const globs = repo.paths?.length ? `  paths: ${repo.paths.join(', ')}` : '  paths: (all files)'
  const output = repo.outputTab ? `  → "${repo.outputTab}"${repo.outputGroup ? ` / "${repo.outputGroup}"` : ''}` : ''
  return `  • ${repo.owner}/${repo.repo}@${repo.branch ?? 'main'}\n  ${globs}${output ? `\n  ${output}` : ''}`
}

function runTrackAdd(args: ParsedArgs): number {
  const spec = args.positionals[1]
  const ref = spec ? parseOwnerRepo(spec) : null
  if (!ref) {
    process.stderr.write('\n  ❌ Usage: dox track add <owner/repo> [--branch <b>] [--paths <globs,csv>] [--tab <tab>] [--group <group>]\n\n')
    return 1
  }

  const projectDir = process.cwd()
  const config = readDocsJson(projectDir)
  const repos = config.tracking?.repos ?? []

  const entry: TrackedRepo = {
    owner: ref.owner,
    repo: ref.repo,
    ...(args.getFlag('--branch') ? { branch: args.getFlag('--branch') } : {}),
    ...(args.getFlag('--paths') ? { paths: args.getFlag('--paths')!.split(',').map((p) => p.trim()).filter(Boolean) } : {}),
    ...(args.getFlag('--tab') ? { outputTab: args.getFlag('--tab') } : {}),
    ...(args.getFlag('--group') ? { outputGroup: args.getFlag('--group') } : {}),
  }

  // Upsert — one entry per owner/repo@branch.
  const key = (r: TrackedRepo) => `${r.owner}/${r.repo}@${r.branch ?? 'main'}`.toLowerCase()
  const existing = repos.findIndex((r) => key(r) === key(entry))
  if (existing !== -1) repos[existing] = entry
  else repos.push(entry)

  config.tracking = { repos }
  writeDocsJson(projectDir, config)

  process.stdout.write(`\n  ✓ ${existing !== -1 ? 'Updated' : 'Added'} tracked repo in docs.json:\n\n${describeRepo(entry)}\n`)
  process.stdout.write('\n  Next: run "dox track setup" to wire the trigger.\n\n')
  return 0
}

function runTrackList(): number {
  const repos = trackedRepos(process.cwd())
  if (repos.length === 0) {
    process.stdout.write('\n  No tracked repos yet. Add one with:\n\n    dox track add <owner/repo> --paths "src/**,openapi.yaml"\n\n')
    return 0
  }
  process.stdout.write(`\n  🔗 Tracked repos (${repos.length})\n\n`)
  for (const repo of repos) process.stdout.write(`${describeRepo(repo)}\n\n`)
  return 0
}

/** Resolve which tracked repo a subcommand targets (arg, or the only entry). */
function resolveTarget(args: ParsedArgs): TrackedRepo | null {
  const repos = trackedRepos(process.cwd())
  const spec = args.positionals[1]
  if (spec) {
    const ref = parseOwnerRepo(spec)
    if (!ref) return null
    const found = repos.find((r) => r.owner.toLowerCase() === ref.owner.toLowerCase() && r.repo.toLowerCase() === ref.repo.toLowerCase())
    // Allow testing a repo that isn't registered yet — use the bare ref.
    return found ?? { owner: ref.owner, repo: ref.repo }
  }
  if (repos.length === 1) return repos[0]
  return null
}

async function runTrackTest(args: ParsedArgs): Promise<number> {
  const target = resolveTarget(args)
  if (!target) {
    process.stderr.write('\n  ❌ Usage: dox track test <owner/repo> [--commit <sha>]\n     (the repo argument is optional when exactly one repo is tracked)\n\n')
    return 1
  }

  process.stdout.write(`\n  🧪 Dox Track — dry run for ${target.owner}/${target.repo}\n\n`)

  const branch = target.branch ?? 'main'
  // One fetch resolves both the SHA and the files: /commits/{ref} accepts a
  // branch name (no separate latest-sha lookup).
  const commitRef = args.getFlag('--commit') ?? branch
  try {
    const commit = await fetchCommit(target.owner, target.repo, commitRef)
    const sha = commit.sha
    const matched = filterFilesByGlobs(commit.files, target.paths)
    if (matched.length === 0) {
      process.stdout.write(`\n  Commit ${sha.slice(0, 7)} touches no tracked paths (${target.paths?.join(', ') ?? 'all'}) — nothing to document.\n\n`)
      return 0
    }

    const task = buildTrackTask(target, { ...commit, files: matched })
    process.stdout.write(`\n  Commit:  ${sha.slice(0, 7)} — ${commit.message.split('\n')[0]}\n`)
    process.stdout.write(`  Files:   ${matched.length} matched (of ${commit.files.length})\n`)
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

function runTrackSetup(args: ParsedArgs): number {
  const repos = trackedRepos(process.cwd())
  const siteUrl = process.env.DOX_SITE_URL?.trim().replace(/\/$/, '') ?? '<your-docs-site>'
  const docsRepo = args.getFlag('--repo') ?? '<owner>/<docs-repo>'

  process.stdout.write('\n  🔗 Dox Track — trigger setup\n')
  process.stdout.write('\n  Pick ONE trigger per tracked repo. Both end in the same place: a dispatch to\n')
  process.stdout.write('  your docs repo, whose "Dox docs agent" workflow drafts the docs PR\n')
  process.stdout.write('  (run "dox agent init" there first if you haven\'t).\n')

  process.stdout.write('\n  ── Option A: GitHub webhook → your deployed Dox site (no files in the product repo)\n\n')
  process.stdout.write(`    1. Generate a secret:            openssl rand -hex 32\n`)
  process.stdout.write(`    2. Set it on the deployed site:  DOX_TRACK_WEBHOOK_SECRET=<secret>\n`)
  process.stdout.write(`       …and set DOX_GITHUB_TOKEN (reads tracked commits + dispatches to the docs repo).\n`)
  process.stdout.write(`    3. In each tracked repo → Settings → Webhooks → Add webhook:\n`)
  process.stdout.write(`         Payload URL:   ${siteUrl}/api/track/webhook\n`)
  process.stdout.write(`         Content type:  application/json\n`)
  process.stdout.write(`         Secret:        <the same secret>\n`)
  process.stdout.write(`         Events:        Just the push event\n`)

  process.stdout.write('\n  ── Option B: sender workflow in the tracked repo (no server in the loop)\n\n')
  if (repos.length === 0) {
    process.stdout.write('    (No tracked repos in docs.json yet — run "dox track add" first to generate\n     a paths-filtered workflow here.)\n\n')
    return 0
  }
  for (const repo of repos) {
    const yaml = trackSenderWorkflow(docsRepo, repo)
    process.stdout.write(`    For ${repo.owner}/${repo.repo} — add .github/workflows/dox-track.yml:\n\n`)
    process.stdout.write(yaml.split('\n').map((line) => `      ${line}`).join('\n'))
    process.stdout.write('\n')
    if (args.hasFlag('--write')) {
      const out = `dox-track-sender-${repo.repo}.yml`
      writeFileSync(join(process.cwd(), out), yaml)
      process.stdout.write(`    ✓ Wrote ${out} (copy it into ${repo.owner}/${repo.repo})\n\n`)
    }
  }
  process.stdout.write('    …and add a DOX_DISPATCH_TOKEN secret in each tracked repo (dispatch access to the docs repo).\n\n')
  return 0
}

/**
 * `dox track <add|list|test|setup>` — register product repos whose commits
 * should become documentation PRs (Dox Track).
 */
export async function runTrackCommand(args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0]
  if (sub === 'add') return runTrackAdd(args)
  if (sub === 'list') return runTrackList()
  if (sub === 'test') return runTrackTest(args)
  if (sub === 'setup') return runTrackSetup(args)

  process.stdout.write('\n  Usage: dox track <subcommand> [options]\n\n')
  process.stdout.write('  Subcommands:\n')
  process.stdout.write('    add <owner/repo>     Track a repo (--branch, --paths csv, --tab, --group)\n')
  process.stdout.write('    list                 List tracked repos\n')
  process.stdout.write('    test [owner/repo]    Dry run: distill the latest commit, preview doc changes\n')
  process.stdout.write('    setup                Print webhook + sender-workflow trigger instructions\n\n')
  return sub ? 1 : 0
}
