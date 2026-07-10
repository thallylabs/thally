import fs from 'node:fs'
import path from 'node:path'
import { AGENT_BRANCH_PREFIX, DOCS_PREVIEW_LABEL, buildTrackInstruction } from '@doxlabs/mcp/track'

/**
 * The docs-repo "hub" workflow: it listens for a dispatched docs task (from a
 * `@dox` comment or a merge in a product repo), runs the agent, and opens a
 * documentation PR — plus a scheduled drift sweep. This is the only place the
 * ANTHROPIC_API_KEY lives; product repos never see it.
 */
export const DOCS_AGENT_WORKFLOW = `name: Dox docs agent

on:
  # A product repo dispatches a docs task here (see the sender workflow).
  repository_dispatch:
    types: [dox-document]
  # Run it by hand from the Actions tab.
  workflow_dispatch:
    inputs:
      instruction:
        description: What to document
        required: true
      from_pr:
        description: Product PR URL (optional context)
        required: false
  # Weekly provenance drift sweep — flags pages whose sources changed.
  schedule:
    - cron: '0 6 * * 1'

permissions:
  contents: write
  pull-requests: write

jobs:
  document:
    if: github.event_name != 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Configure git
        run: |
          git config user.name "dox-agent"
          git config user.email "dox-agent@users.noreply.github.com"
      - name: Draft docs and open a PR
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          # A fine-grained PAT / App token with write on this docs repo (and read
          # on your product repos). Falls back to the built-in token.
          GH_TOKEN: \${{ secrets.DOX_AGENT_TOKEN || secrets.GITHUB_TOKEN }}
          # Lets the agent read tracked product-repo PRs (Dox Track).
          DOX_GITHUB_TOKEN: \${{ secrets.DOX_AGENT_TOKEN || secrets.GITHUB_TOKEN }}
          # Dispatch/input values are passed as ENV, never expanded inline into the
          # run script — untrusted content in the instruction can't inject shell
          # commands (GitHub Actions script-injection hardening).
          INSTRUCTION: \${{ github.event.client_payload.instruction || inputs.instruction }}
          FROM_PR: \${{ github.event.client_payload.from_pr || inputs.from_pr }}
        run: |
          if [ -n "$FROM_PR" ]; then
            npx dox agent "$INSTRUCTION" --from-pr "$FROM_PR" --pr
          else
            npx dox agent "$INSTRUCTION" --pr
          fi

  drift-sweep:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Check for stale docs
        run: npx dox check --drift --ci
`

/** Product-repo sender: a `@dox` comment on a PR dispatches a task to the docs repo. */
export function mentionSenderWorkflow(docsRepo: string): string {
  return `name: Dox mention

on:
  issue_comment:
    types: [created]

jobs:
  dispatch:
    # Only PR comments from collaborators, starting with "@dox".
    if: >-
      github.event.issue.pull_request &&
      startsWith(github.event.comment.body, '@dox') &&
      contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch docs task
        env:
          GH_TOKEN: \${{ secrets.DOX_DISPATCH_TOKEN }}
        run: |
          INSTRUCTION="\${{ github.event.comment.body }}"
          PR_URL="\${{ github.event.issue.html_url }}"
          gh api repos/${docsRepo}/dispatches -f event_type=dox-document \\
            -F "client_payload[instruction]=\${INSTRUCTION#@dox }" \\
            -F "client_payload[from_pr]=$PR_URL" \\
            -F "client_payload[requester]=\${{ github.event.comment.user.login }}"
`
}

/**
 * Product-repo sender: on merge to main, dispatch a task iff the diff touches
 * documented surface. Edit the paths filter to match your `watch` globs.
 */
export function mergeSenderWorkflow(docsRepo: string): string {
  return `name: Dox merge dispatch

on:
  push:
    branches: [main]
    paths:
      # Only fire when documented surface changes (match your docs.json watch globs).
      - 'src/**'
      - 'openapi.yaml'

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch docs task
        env:
          GH_TOKEN: \${{ secrets.DOX_DISPATCH_TOKEN }}
        run: |
          gh api repos/${docsRepo}/dispatches -f event_type=dox-document \\
            -F "client_payload[instruction]=Document the changes merged in \${{ github.repository }}@\${{ github.sha }}" \\
            -F "client_payload[from_pr]=\${{ github.event.head_commit.url }}"
`
}

export interface TrackSenderRepo {
  owner: string
  repo: string
  branch?: string
  paths?: Array<string>
  outputTab?: string
  outputGroup?: string
}

/**
 * Product-repo sender for Dox Track: dispatch a `from_pr` docs task to the docs
 * repo when a PR either MERGES into the tracked base branch, OR is an open PR
 * labelled `docs-preview` (draft the docs BEFORE the feature ships). The
 * pure-GitHub-Actions alternative to the webhook relay — no server in the loop.
 *
 * Two safeguards mirror the webhook: a loop guard skips the docs agent's own
 * `dox/agent-*` branches (so a self-tracking repo doesn't chase its own tail),
 * and everything untrusted (PR number/url/login) flows through ENV so bash never
 * re-parses it. The placement directive is baked from the tracking config —
 * escaped for the double-quoted bash context so a tab/group name containing a
 * quote, backtick, `$`, or backslash can't break out of the string.
 */
export function trackSenderWorkflow(docsRepo: string, repo: TrackSenderRepo): string {
  const branch = repo.branch ?? 'main'
  const pathsBlock = repo.paths?.length
    ? `\n    paths:\n${repo.paths.map((p) => `      - '${p}'`).join('\n')}`
    : ''
  // Escape values baked into the double-quoted INSTRUCTION="…" bash string.
  const bashDq = (s: string) => s.replace(/([\\"$`])/g, '\\$1')
  // ONE source of truth for the instruction prose: build it the same way the
  // webhook relay does (buildTrackInstruction), with the runtime PR number as a
  // token we swap for the bash env var AFTER escaping (so the $ isn't escaped).
  const PR_TOKEN = '__DOX_PR_NUMBER__'
  const bake = (preview: boolean) =>
    bashDq(buildTrackInstruction(repo, { number: PR_TOKEN as unknown as number }, { preview })).replace(
      PR_TOKEN,
      '${DOX_PR_NUMBER}',
    )
  const mergedInstruction = bake(false)
  const previewInstruction = bake(true)
  // docsRepo lands UNQUOTED in the `gh api repos/<docsRepo>/dispatches` path —
  // constrain it to a valid owner/repo so it can't inject a shell metachar.
  const safeDocsRepo = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(docsRepo) ? docsRepo : 'OWNER/DOCS-REPO'
  return `name: Dox track dispatch

on:
  pull_request:
    # closed → catches merges; labeled/synchronize/opened/reopened → catches
    # docs-preview requests (matches the webhook path's preview actions).
    types: [closed, labeled, synchronize, opened, reopened]
    branches: [${branch}]${pathsBlock}

jobs:
  dispatch:
    # Fire when the PR MERGED, or when it's an OPEN, docs-preview-labelled PR —
    # but never for the docs agent's own branches (loop guard).
    if: >-
      !startsWith(github.event.pull_request.head.ref, '${AGENT_BRANCH_PREFIX}') &&
      (github.event.pull_request.merged == true ||
       (github.event.action != 'closed' &&
        contains(github.event.pull_request.labels.*.name, '${DOCS_PREVIEW_LABEL}')))
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch docs task
        env:
          GH_TOKEN: \${{ secrets.DOX_DISPATCH_TOKEN }}
          DOX_PR_URL: \${{ github.event.pull_request.html_url }}
          DOX_PR_NUMBER: \${{ github.event.pull_request.number }}
          DOX_REQUESTER: \${{ github.event.pull_request.user.login }}
          DOX_MERGED: \${{ github.event.pull_request.merged }}
        run: |
          if [ "$DOX_MERGED" = "true" ]; then
            INSTRUCTION="${mergedInstruction}"
            PREVIEW=false
          else
            INSTRUCTION="${previewInstruction}"
            PREVIEW=true
          fi
          gh api repos/${safeDocsRepo}/dispatches -f event_type=dox-document \\
            -F "client_payload[instruction]=\${INSTRUCTION}" \\
            -F "client_payload[from_pr]=\${DOX_PR_URL}" \\
            -F "client_payload[requester]=\${DOX_REQUESTER}" \\
            -F "client_payload[preview]=\${PREVIEW}"
`
}

/**
 * Gate who can change the admin team roster: a PR touching docs.json needs a
 * designated owner's approval. Pair with branch protection on main. This is the
 * answer to "can anyone invite themselves via a PR?" — no, not without approval.
 */
export function codeownersFor(team = '@your-org/docs-admins'): string {
  return `# Changes to the admin team roster (the "team" block) require approval from a
# designated owner. REQUIRES branch protection on main (PRs + required review),
# otherwise a direct push bypasses this.
/docs.json   ${team}
`
}

export interface ScaffoldResult {
  written: Array<string>
  senderSnippet: string
}

/** Write the docs-repo agent workflow + a CODEOWNERS roster gate; return the sender snippet. */
export function scaffoldAgentWorkflow(projectDir: string, docsRepo = '<owner>/<docs-repo>'): ScaffoldResult {
  const written: Array<string> = []

  const wfDir = path.join(projectDir, '.github', 'workflows')
  fs.mkdirSync(wfDir, { recursive: true })
  const wf = path.join(wfDir, 'dox-agent.yml')
  fs.writeFileSync(wf, DOCS_AGENT_WORKFLOW)
  written.push(path.relative(projectDir, wf))

  const co = path.join(projectDir, '.github', 'CODEOWNERS')
  if (!fs.existsSync(co)) {
    fs.writeFileSync(co, codeownersFor())
    written.push(path.relative(projectDir, co))
  }

  return { written, senderSnippet: mentionSenderWorkflow(docsRepo) }
}
