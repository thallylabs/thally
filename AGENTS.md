# Thally public repository instructions

## Repository role

`thallylabs/thally` is the only authored source for the open-source runtime,
cloud-bridge contract, and public packages. `thallylabs/starter` is the complete
customer-ready snapshot generated from one exact runtime commit.
`thallylabs/thally-cloud` is the private control plane and managed-service
implementation.

The sole production architecture authority is
[`thally-cloud/ARCHITECTURE.md`](https://github.com/thallylabs/thally-cloud/blob/main/ARCHITECTURE.md).
That repository is private; maintainers without access should treat this file
and `README.md` as public-boundary guidance, not as a second full-platform
architecture.

## Ownership boundaries

- Author runtime, rendering, structured content, search, machine projections,
  the bridge interface, and public CLI/MCP/agent packages here.
- Never import the private `thally-cloud/src/cloud` implementation. Public code
  reaches managed services only through `src/lib/cloud-bridge` and must handle
  the service being absent.
- Do not hand-apply runtime changes in `thallylabs/starter`. The synchronization
  workflow generates the runtime-owned snapshot and proves byte parity.
- Customer-owned paths include `src/content/`, `docs.json`, `src/data/site.ts`,
  `src/mdx/custom-components.tsx`, `snippets/`, `public/`, and API
  specifications. Runtime upgrades must preserve them.
- A package version, scaffold release, managed site release, and Cloud platform
  release are different artifacts. Do not imply that publishing one upgrades
  the others.

## Change placement and validation

Trace the real entrypoint to the artifact it creates before editing. Public
runtime and package work belongs here; starter-owned seed content belongs in
`starter`; paid service internals belong in `thally-cloud`. A paid feature with
a public surface may require a bridge-contract change here and a private
implementation in Cloud.

Match validation to risk. Runtime, shared-contract, routing, dependency, or
build changes require the relevant full suites and a generated-starter parity
check. Documentation-only corrections require focused formatting, link, and
content checks. Pull requests target `main` directly.

Do not create another architecture document. Update the canonical Cloud
architecture in the same change whenever a production boundary or lifecycle
changes.

## Worktree and git-operation preferences — standing consent

The user permanently authorizes Codex to create isolated git worktrees whenever
they protect unrelated local changes or produce cleaner branch history. Do not
ask for worktree consent in this repository; proceed automatically, including
in new sessions.

GitHub authentication may be available outside the agent sandbox. Codex has
standing permission to run authenticated git and GitHub CLI operations outside
the sandbox whenever needed; request the harness escalation directly without a
separate conversational approval question. Destructive-action safeguards still
apply.

Pull requests for features, fixes, and maintenance must target `main`
directly. The pull request's CI and deploy preview are the release-candidate
gate. After that preview is approved, merge the same reviewed commit to `main`;
production deploys it once and captures an immutable rollback record.

## Git — commit and push only when AI-attribution-free

Coding agents may run `git commit`, `git push`, and GitHub CLI commands when
the user asks — **if and only if** they can confirm the commit message contains
no AI attribution of any kind.

Before committing or pushing, verify the message has none of:

- `Co-Authored-By:` trailers naming an AI, agent, or tool
- Phrases such as "Generated with Codex", "Generated with Cursor", "Made with
  Claude Code", or equivalent
- Emoji badges, HTML-comment watermarks, or other AI-attribution trailers

If a hook or tool may inject attribution after the message is drafted, do not
commit or push; provide the user with an all-inclusive copy-paste command
instead.

Every other Git action is allowed. Before committing or pushing, use a plain
conventional-commit message, verify the final subject, body, and trailers are
attribution-free, and list the files intended for the commit. Write for an
open-source audience: keep the subject at or below 72 characters and use the
body only for maintainer-relevant context.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
