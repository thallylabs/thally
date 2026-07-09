import fs from 'node:fs'
import path from 'node:path'

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
      from_commit:
        description: Tracked commit spec, owner/repo@sha (optional context)
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
          # Lets the agent read tracked product-repo commits (Dox Track).
          DOX_GITHUB_TOKEN: \${{ secrets.DOX_AGENT_TOKEN || secrets.GITHUB_TOKEN }}
          # Dispatch/input values are passed as ENV, never expanded inline into the
          # run script — untrusted commit content in the instruction can't inject
          # shell commands (GitHub Actions script-injection hardening).
          INSTRUCTION: \${{ github.event.client_payload.instruction || inputs.instruction }}
          FROM_PR: \${{ github.event.client_payload.from_pr || inputs.from_pr }}
          FROM_COMMIT: \${{ github.event.client_payload.from_commit || inputs.from_commit }}
        run: |
          if [ -n "$FROM_COMMIT" ]; then
            npx dox agent "$INSTRUCTION" --from-commit "$FROM_COMMIT" --pr
          elif [ -n "$FROM_PR" ]; then
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
 * Product-repo sender for Dox Track: on push to the tracked branch (optionally
 * filtered by paths), dispatch a `from_commit` docs task to the docs repo. The
 * pure-GitHub-Actions alternative to the webhook relay — no server in the loop.
 * The placement + provenance directives are baked in from the tracking config,
 * mirroring what the webhook relay's distiller produces.
 */
export function trackSenderWorkflow(docsRepo: string, repo: TrackSenderRepo): string {
  const branch = repo.branch ?? 'main'
  const pathsBlock = repo.paths?.length
    ? `\n    paths:\n${repo.paths.map((p) => `      - '${p}'`).join('\n')}`
    : ''
  // Baked from trusted docs.json config (no shell metacharacters). The commit
  // message is NOT embedded (it's untrusted and the docs-repo Action rebuilds
  // full context from --from-commit anyway). github.sha / pusher.name flow
  // through ENV so bash never re-parses them.
  const placement = repo.outputTab
    ? ` If new pages are warranted, add them under the ${repo.outputTab} tab${repo.outputGroup ? ` (${repo.outputGroup} group)` : ''}.`
    : ''
  const spec = `${repo.owner}/${repo.repo}`
  return `name: Dox track dispatch

on:
  push:
    branches: [${branch}]${pathsBlock}

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch docs task
        env:
          GH_TOKEN: \${{ secrets.DOX_DISPATCH_TOKEN }}
          DOX_SHA: \${{ github.sha }}
          DOX_REQUESTER: \${{ github.event.pusher.name }}
        run: |
          INSTRUCTION="A change landed in ${spec}@\${DOX_SHA:0:7}. Review the diff and decide what user-facing behavior it changes, then find and update the documentation pages that describe it so the docs match.${placement} Make no change if the diff has no user-facing impact."
          gh api repos/${docsRepo}/dispatches -f event_type=dox-document \\
            -F "client_payload[instruction]=\${INSTRUCTION}" \\
            -F "client_payload[from_commit]=${spec}@\${DOX_SHA}" \\
            -F "client_payload[requester]=\${DOX_REQUESTER}"
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
