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

## Change placement and validation

Trace the real entrypoint to the artifact it creates before editing. Match
validation to risk: runtime, shared-contract, routing, dependency, or build
changes need the full test suite (`npm test`), lint (`npm run lint`), and a
production build (`npm run build`). Documentation-only corrections need
focused formatting, link, and content checks.

Pull requests target `main` directly. The pull request's CI and deploy preview
are the release-candidate gate.

## Repository operations

Coding agents may perform authenticated git and GitHub operations when the
user requests them or when they are normal, in-scope steps of the requested
workflow. This includes staging files, committing, pushing branches, creating
or updating issues and pull requests, submitting reviews, merging approved
pull requests, and dispatching documented workflows. Do not ask the user to
repeat these operations merely because an agent is performing the work.

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
