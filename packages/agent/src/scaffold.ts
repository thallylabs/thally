import fs from 'node:fs'
import path from 'node:path'
import { AGENT_BRANCH_PREFIX, DOCS_PREVIEW_LABEL, buildTrackInstruction } from '@thallylabs/mcp/track'

/** Version marker used by Cloud Track to offer reviewable workflow upgrades. */
export const DOCS_AGENT_WORKFLOW_CONTRACT = 'thally-track/v2'

/**
 * The docs-repo "hub" workflow: it listens for a dispatched docs task (from a
 * `@thally` comment or a merge in a product repo), runs the agent, and opens a
 * documentation PR — plus a scheduled drift sweep. This is the only place the
 * ANTHROPIC_API_KEY lives; product repos never see it.
 */
const DOCS_AGENT_WORKFLOW_TEMPLATE = `# Contract: ${DOCS_AGENT_WORKFLOW_CONTRACT}
name: Thally docs agent

on:
  # A product repo dispatches a docs task here (see the sender workflow).
  repository_dispatch:
    types: [thally-document]
  # Run it by hand from the Actions tab.
  workflow_dispatch:
    inputs:
      instruction:
        description: What to document
        required: true
      from_pr:
        description: Product PR URL (optional context)
        required: false
      context:
        description: Pre-resolved product PR context (optional)
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
          git config user.name "thally-agent"
          git config user.email "thally-agent@users.noreply.github.com"
      - name: Draft docs and open a PR
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          THALLY_AGENT_MODEL: \${{ vars.THALLY_AGENT_MODEL }}
          # A fine-grained PAT / App token with write on this docs repo (and read
          # on your product repos). Falls back to the built-in token.
          GH_TOKEN: \${{ secrets.THALLY_AGENT_TOKEN || secrets.GITHUB_TOKEN }}
          # Lets the agent read tracked product-repo PRs (Thally Track).
          THALLY_GITHUB_TOKEN: \${{ secrets.THALLY_AGENT_TOKEN || secrets.GITHUB_TOKEN }}
          # Dispatch/input values are passed as ENV, never expanded inline into the
          # run script — untrusted content in the instruction can't inject shell
          # commands (GitHub Actions script-injection hardening).
          INSTRUCTION: \${{ github.event.client_payload.instruction || inputs.instruction }}
          FROM_PR: \${{ github.event.client_payload.from_pr || inputs.from_pr }}
          TRACK_CONTEXT: \${{ github.event.client_payload.context || inputs.context }}
          REQUESTER: \${{ github.event.client_payload.requester }}
        run: |
          run_thally() {
            if [ -x node_modules/.bin/thally ]; then
              # Existing sites may pin an older CLI that cannot consume the
              # App-resolved private PR context. Keep Track's receiver pinned
              # to the workflow contract version without editing package.json.
              npm install --no-save --package-lock=false --ignore-scripts @thallylabs/cli@0.5.2
              node_modules/.bin/thally "$@"
              return
            fi
            npm run packages:build
            node packages/cli/dist/index.js "$@"
          }
          REQUESTER_ARGS=()
          if [ -n "$REQUESTER" ]; then
            REQUESTER_ARGS=(--requester "$REQUESTER")
          fi
          if [ -n "$TRACK_CONTEXT" ]; then
            CONTEXT_FILE="$RUNNER_TEMP/thally-track-context.md"
            printf '%s' "$TRACK_CONTEXT" > "$CONTEXT_FILE"
            run_thally agent "$INSTRUCTION" --from-pr "$FROM_PR" --context-file "$CONTEXT_FILE" "\${REQUESTER_ARGS[@]}" --pr
          elif [ -n "$FROM_PR" ]; then
            run_thally agent "$INSTRUCTION" --from-pr "$FROM_PR" "\${REQUESTER_ARGS[@]}" --pr
          else
            run_thally agent "$INSTRUCTION" "\${REQUESTER_ARGS[@]}" --pr
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
        run: |
          if [ -x node_modules/.bin/thally ]; then
            node_modules/.bin/thally check --drift --ci
          else
            npm run packages:build
            node packages/cli/dist/index.js check --drift --ci
          fi
`

export interface DocsAgentWorkflowOptions {
  /** Branch containing the production docs; repository_dispatch still reads this workflow from the default branch. */
  docsBranch?: string
  /** Repository-relative directory containing docs.json for monorepo sites. */
  docsRootDir?: string | null
}

/**
 * Build the docs-side receiver for a specific connected site.
 *
 * GitHub loads repository_dispatch workflows only from the repository default
 * branch. Cloud therefore installs this file there while an explicit checkout
 * ref and working directory keep agent edits on the site's configured docs
 * branch/root.
 */
export function buildDocsAgentWorkflow(options: DocsAgentWorkflowOptions = {}): string {
  const docsBranch = options.docsBranch?.trim()
  const docsRootDir = options.docsRootDir?.replace(/^\/+|\/+$/g, '')
  if (docsRootDir?.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('The docs root must be a repository-relative directory.')
  }

  let workflow = DOCS_AGENT_WORKFLOW_TEMPLATE
  if (docsBranch) {
    workflow = workflow.replaceAll(
      '          fetch-depth: 0',
      `          fetch-depth: 0\n          ref: ${JSON.stringify(docsBranch)}`,
    )
  }
  if (docsRootDir) {
    workflow = workflow.replaceAll(
      '    runs-on: ubuntu-latest\n    steps:',
      `    runs-on: ubuntu-latest\n    defaults:\n      run:\n        working-directory: ${JSON.stringify(docsRootDir)}\n    steps:`,
    )
  }
  return workflow
}

/** Generic root/default-branch receiver scaffolded by the public CLI. */
export const DOCS_AGENT_WORKFLOW = buildDocsAgentWorkflow()

/** Product-repo sender: a `@thally` comment on a PR dispatches a task to the docs repo. */
export function mentionSenderWorkflow(docsRepo: string): string {
  return `name: Thally mention

on:
  issue_comment:
    types: [created]

jobs:
  dispatch:
    # Only PR comments from collaborators, starting with "@thally".
    if: >-
      github.event.issue.pull_request &&
      startsWith(github.event.comment.body, '@thally') &&
      contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch docs task
        env:
          GH_TOKEN: \${{ secrets.THALLY_DISPATCH_TOKEN }}
        run: |
          INSTRUCTION="\${{ github.event.comment.body }}"
          PR_URL="\${{ github.event.issue.html_url }}"
          gh api repos/${docsRepo}/dispatches -f event_type=thally-document \\
            -F "client_payload[instruction]=\${INSTRUCTION#@thally }" \\
            -F "client_payload[from_pr]=$PR_URL" \\
            -F "client_payload[requester]=\${{ github.event.comment.user.login }}"
`
}

/**
 * Product-repo sender: on merge to main, dispatch a task iff the diff touches
 * documented surface. Edit the paths filter to match your `watch` globs.
 */
export function mergeSenderWorkflow(docsRepo: string): string {
  return `name: Thally merge dispatch

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
          GH_TOKEN: \${{ secrets.THALLY_DISPATCH_TOKEN }}
        run: |
          gh api repos/${docsRepo}/dispatches -f event_type=thally-document \\
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
 * Product-repo sender for Thally Track: dispatch a `from_pr` docs task to the docs
 * repo when a PR either MERGES into the tracked base branch, OR is an open PR
 * labelled `docs-preview` (draft the docs BEFORE the feature ships). The
 * pure-GitHub-Actions alternative to the webhook relay — no server in the loop.
 *
 * Two safeguards mirror the webhook: a loop guard skips the docs agent's own
 * `thally/agent-*` branches (so a self-tracking repo doesn't chase its own tail),
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
  const PR_TOKEN = '__THALLY_PR_NUMBER__'
  const bake = (preview: boolean) =>
    bashDq(buildTrackInstruction(repo, { number: PR_TOKEN as unknown as number }, { preview })).replace(
      PR_TOKEN,
      '${THALLY_PR_NUMBER}',
    )
  const mergedInstruction = bake(false)
  const previewInstruction = bake(true)
  // docsRepo lands UNQUOTED in the `gh api repos/<docsRepo>/dispatches` path —
  // constrain it to a valid owner/repo so it can't inject a shell metachar.
  const safeDocsRepo = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(docsRepo) ? docsRepo : 'OWNER/DOCS-REPO'
  return `name: Thally track dispatch

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
          GH_TOKEN: \${{ secrets.THALLY_DISPATCH_TOKEN }}
          THALLY_PR_URL: \${{ github.event.pull_request.html_url }}
          THALLY_PR_NUMBER: \${{ github.event.pull_request.number }}
          THALLY_REQUESTER: \${{ github.event.pull_request.user.login }}
          THALLY_MERGED: \${{ github.event.pull_request.merged }}
        run: |
          if [ "$THALLY_MERGED" = "true" ]; then
            INSTRUCTION="${mergedInstruction}"
            PREVIEW=false
          else
            INSTRUCTION="${previewInstruction}"
            PREVIEW=true
          fi
          gh api repos/${safeDocsRepo}/dispatches -f event_type=thally-document \\
            -F "client_payload[instruction]=\${INSTRUCTION}" \\
            -F "client_payload[from_pr]=\${THALLY_PR_URL}" \\
            -F "client_payload[requester]=\${THALLY_REQUESTER}" \\
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
  const wf = path.join(wfDir, 'thally-agent.yml')
  fs.writeFileSync(wf, DOCS_AGENT_WORKFLOW)
  written.push(path.relative(projectDir, wf))

  const co = path.join(projectDir, '.github', 'CODEOWNERS')
  if (!fs.existsSync(co)) {
    fs.writeFileSync(co, codeownersFor())
    written.push(path.relative(projectDir, co))
  }

  return { written, senderSnippet: mentionSenderWorkflow(docsRepo) }
}
