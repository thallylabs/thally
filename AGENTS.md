# Thally repository instructions

## Repository role

`thallylabs/thally` is the source for the open-source Thally runtime, the
cloud-bridge contract, and the public packages under `packages/`.
`thallylabs/starter` is the standalone site template that `create-thally-docs`,
`thally init`, and MCP project creation scaffold from. Its runtime-owned files
are generated from this repository, so runtime and framework changes belong
here, not in the starter.

<!-- Cross-repository maintainers: consult thallylabs/thally-cloud/AGENTS.md
before changing shared contracts or release behavior. -->

## Skills first

Before each task, check the available project-scoped and global skills. Prefer
project-scoped guidance when multiple skills apply. Read relevant `SKILL.md`
files before implementing a solution; do not skip the check because a task
looks simple. Use the skill locations exposed by the active agent environment,
including `.codex/skills/`, `.agents/skills/`, or agent-specific equivalents
when present.

## Ownership boundaries

- Runtime, rendering, structured content, search, machine projections, the
  cloud-bridge interface, and the CLI, MCP, and agent packages live here.
- Engine code reaches managed services only through `src/lib/cloud-bridge`
  and must keep working when a service is absent. An ESLint rule enforces
  that nothing outside the bridge imports `src/cloud` directly.
- Customer-owned paths include `src/content/`, `docs.json`, `src/data/site.ts`,
  `src/mdx/custom-components.tsx`, `snippets/`, `public/`, and API
  specifications. Runtime upgrades must preserve them.
- A package version, a scaffold release, and a managed site release are
  separate artifacts. Publishing one does not upgrade the others.

## Change placement

For every feature or fix, decide its placement before editing:

- **Public runtime:** content processing, rendering, search, machine and SEO
  projections, shared packages, CLI, MCP, and agent behavior belong here.
- **Starter:** seed content, portable defaults, and template packaging belong
  in the standalone starter. Runtime-owned files are generated from one exact
  Thally commit; do not hand-apply runtime fixes in both repositories.
- **Managed services:** paid service implementations, control-plane behavior,
  billing, and managed workers belong in the companion managed-service
  repository. Keep private implementation details out of this public tree.
- **Mixed features:** public route shells, locked panels, and bridge interfaces
  belong here; managed implementations belong in the companion repository.
  Keep both sides compatible with the same bridge contract.

Trace the real entrypoint through code to the artifact it creates or deploys.
Use current architecture documentation where available and verify it against
code; planning documents do not establish current production behavior.

After bridge-contract or shared-package changes, synchronize the relevant
public changes into the companion repository and run its full test suite in
the same working session. Do not merge the two root applications as if they
were interchangeable.

Runtime changes must reach scaffolded sites through the starter synchronization
workflow. Verify generated-file parity and a real `create-thally-docs` output;
add CLI/MCP affordances and documentation where relevant.

## Change placement and validation

Trace the real entrypoint to the artifact it creates before editing. Match
validation to risk: runtime, shared-contract, routing, dependency, or build
changes need the full test suite (`npm test`), lint (`npm run lint`), and a
production build (`npm run build`). Documentation-only corrections need
focused formatting, link, and content checks.

Use focused checks for cosmetic UI, copy, and other low-risk edits. Do not run
an exhaustive suite or production build for a documentation-only update, or
repeat already completed checks without a new change or unresolved concern.
Required CI and release gates still apply; never skip a required check.

Review the completed change for correctness and security before calling the
work done. Scale the review to the risk; review a related series of edits once
at the completed goal rather than after every small step.

Pull requests target `main` directly. The pull request's CI and deploy preview
are the release-candidate gate.

## Project conventions

- Use TypeScript and functional, declarative patterns. Prefer interfaces for
  object contracts and maps over enums; use descriptive names such as
  `isLoading` and `hasError`. Follow established local conventions.
- Explain module roles and invariants, document exported functions with JSDoc,
  and comment on non-obvious constraints and failure behavior. Explain intent
  rather than narrating individual statements.
- Keep user configuration in `docs.json`, `src/data/site.ts`, and `THALLY_*`
  environment variables. Preserve existing `DOX_*` fallbacks where supported;
  do not require customers to edit framework internals.
- Use the structured content representation as the source for HTML, JSON,
  JSON-LD, Markdown, and embeddings. Do not introduce a second parser for a
  separate projection.
- Preserve middleware bypasses for `rsc`, `next-router-state-tree`, and
  `next-router-prefetch`. Use headers rather than rewrites on documentation
  pages. Middleware changes need RSC-navigation regression tests.
- Place tests alongside the existing relevant suites, including
  `src/lib/__tests__/` and package test directories. Run `thally check` when
  substantive changes affect the site or scaffold contracts it validates.
- New environment variables must be optional with safe defaults and documented
  in `.env.example` and the relevant README configuration table.

## Database migrations

Write schema migrations as plain `.sql` files in the project's migrations
directory, using timestamped filenames when creating a new migration directory.
Do not execute migrations, run database push commands, or issue SQL against a
database. Provide the complete executable SQL in the final response, together
with its file path and a one-line summary, so the user can run it directly.
Make migrations idempotent where practical and explicitly flag destructive
operations before the user executes them.

## Repository operations

Coding agents may perform authenticated git and GitHub operations when the
user requests them or when they are normal, in-scope steps of the requested
workflow. This includes staging files, committing, pushing branches, creating
or updating issues and pull requests, submitting reviews, merging approved
pull requests, and dispatching documented workflows. Do not ask the user to
repeat these operations merely because an agent is performing the work.

Create isolated git worktrees without an additional consent request when they
protect unrelated local changes or keep branch history clean. Use the active
environment's authentication and permission mechanisms for git operations;
do not assume a particular sandbox or escalation capability.

Before committing or publishing repository metadata, confirm that the commit
message, issue or pull-request text, review, and other agent-authored metadata
contain no AI attribution. Never add `Co-Authored-By` trailers naming an AI,
phrases such as "Generated with Codex" or "Made with Claude Code", badges,
watermarks, or equivalent attribution. If a hook or tool could inject
attribution and the final output cannot be verified, do not perform that
operation; give the user one complete copy-pasteable command instead.

Destructive-action safeguards still apply. Features, fixes, and maintenance
pull requests target `main`, and agents must not bypass required CI, review,
deploy-preview, or documented release gates.

Because this repository is public, keep agent-authored commit messages, issue
descriptions, pull-request descriptions, and review comments deliberately
discreet. State only the minimum accurate context a maintainer needs, avoid
internal operational details, and do not publish private repository names,
infrastructure identifiers, customer data, audit narratives, or security
details that belong in a private channel.

If attribution-free output cannot be verified, provide one complete
copy-pasteable command block for the requested workflow, including staging,
commit, push, and PR creation when needed. List the intended files before or
after committing so the staging scope is clear.

## Commit messages

Use plain conventional-commit messages written for an open-source audience.
Keep the subject at or below 72 characters and use the body only for
essential maintainer context. Prefer concise, general descriptions when the
specific operational context is private. Do not add AI-attribution trailers,
badges, or watermarks of any kind.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
