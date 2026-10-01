# AGENTS.md

Instructions for Codex when working in this repository (Thally — an
agent-native documentation platform: a Next.js template plus the `thally`
toolchain in `packages/{agent,cli,create-thally-docs,mcp}`).

## 1. Skills first — check before every task

On **every** prompt, before writing any code or hand-rolling a solution:

1. Check **project-scoped skills** in `.Codex/skills/`.
2. Check **global skills** in `~/.Codex/skills/`.
3. If a skill is relevant to the task, read its `SKILL.md` and follow it.
4. Only when no relevant skill exists may you hand-roll the solution.

Do not skip this check because the task looks simple. If multiple skills apply,
prefer the project-scoped one.

## Worktree and git-operation preferences — standing consent

The user permanently authorizes Codex to create isolated git worktrees whenever
they protect unrelated local changes or produce cleaner branch history. Do not
ask for worktree consent in this repository; proceed automatically, including
in new sessions.

GitHub authentication is not available inside the agent sandbox. Codex has
standing permission to run authenticated git and GitHub CLI operations outside
the sandbox whenever needed; request the harness escalation directly without a
separate conversational approval question. Destructive-action safeguards still
apply.

Pull requests for features, fixes, and maintenance must target `main` directly.
The pull request's CI and Netlify deploy preview are the release-candidate
gate. After that preview is approved, merge the same reviewed commit to `main`;
production deploys it once and captures an immutable rollback record.

The former long-lived `staging` branch and `staging`-to-`main` promotion pull
request are retired. Never open or recreate that promotion path, and never run
a second verification pipeline merely because an already verified pull request
was merged. Staging-only provider resources remain available for isolated
integration drills, but they do not determine Git branch or pull-request
targets.

Platform releases use one human approval for the latest intended `main`
candidate in the secret-free `release-approval` environment. Registration
freezes the candidate and its Worker selection. Successful registration
dispatches only those selected Workers from the immutable candidate tag;
their deployments and manifest finalization proceed automatically without
additional release approvals. The `production` environment retains secrets
and variables but has no required reviewer after the documented cutover.
Each selected Worker dispatches finalization after its receipt upload because
GitHub suppresses chained `workflow_run` events from token-dispatched Workers.
Manual production Worker deployments, rollback, and other operator actions
have their own explicit authorization jobs. Follow
`docs/operations/platform-release-queue.md` for the queue and transition
procedure. Audit approvals before and after every release: cancel only requests
proven superseded by published artifact coverage, and carry still-valid work
into the latest reviewed release. Do not leave a release with unexplained
waiting, pending, or queued approvals; also inspect current-head fork CI runs
with `action_required`. Never restore per-Worker release approval gates.

## Validation scope — proportional to risk

Use the narrowest checks that meaningfully cover the change. Cosmetic UI,
copy, documentation, and similarly low-risk edits do **not** justify the full
test suite, a production build, or `thally check`; run targeted formatting,
lint, type, or focused tests only when relevant. Reserve exhaustive validation
for behavioral changes, shared contracts, dependencies, schemas, routing or
middleware, build configuration, broad refactors, or when the user explicitly
requests it.

Do not duplicate remote CI locally or wait for an exhaustive pipeline after a
low-risk change. When safely supported by the repository, use a skip-CI commit
marker for cosmetic or text-only follow-ups so publishing the change does not
consume a full CI run.

## 2. Git — commit and push only when AI-attribution-free

Coding agents (Codex, Cursor, Claude Code, and similar) **may** run
`git commit` and `git push` when the user asks — **if and only if** they can
confirm the commit message contains **no AI attribution of any kind**.

Before committing or pushing, verify the message has none of:

- `Co-Authored-By:` trailers naming an AI / agent / tool
- Phrases like "Generated with Codex", "Generated with Cursor",
  "Made with Claude Code", or equivalent
- Emoji badges, HTML comment watermarks, or other AI attribution trailers

If you cannot confirm the message is clean (e.g. a hook or tool may inject
attribution after you draft it), do **not** commit or push — hand the user a
copy-paste-able command block instead.

**Every other git action is allowed.** `git add`, `git rm`, `git mv`,
`git checkout`, `git stash`, branch operations, and read-only `status`/`log`/
`diff` are fine during normal work. The hard constraint is clean history, not
avoiding git.

When the user asks to commit and/or push:

1. Draft a plain conventional-commit message with **no attribution**.
2. Confirm the final message (subject + body + trailers) is AI-attribution-free.
3. Only then run `git commit` / `git push` yourself. If confirmation fails,
   hand the user one all-inclusive, copy-paste-able command block — not a
   bare commit message or a lone `git push`. Include everything needed end
   to end (directory change, `git add`, `git commit`, `git push`, and
   `gh pr create` when a PR is part of the ask), chained with `&&`, unless
   there is a real necessity to split (e.g. an interactive step, or a
   decision the user must make mid-flow). Example:

   ```bash
   cd /path/to/repo && \
   git add src/lib/foo.ts src/lib/__tests__/foo.test.ts && \
   git commit -m "fix: handle empty search corpus in hybrid mode" && \
   git push -u origin <branch> && \
   gh pr create --title "fix: handle empty search corpus in hybrid mode" --body "$(cat <<'EOF'
   ## Summary
   - Why this change matters.

   ## Test plan
   - [ ] Relevant checks pass.
   EOF
   )"
   ```

4. **Write for an open-source audience.** Thousands of people will read this
   history. Subject ≤ 72 chars; the body carries only what a maintainer needs
   to understand the change (the what and the why). No housekeeping trivia
   (e.g. "delete stray dir"), no process narration, no verification logs.
5. List the files intended for the commit so the user can verify the staging
   list before (or after) the operation.

## 3. Database migrations — write, never execute

For any database schema change (local libSQL/Turso today; the Thally Cloud
Postgres when it exists):

1. Write the migration as a plain `.sql` file in the project's migrations
   directory (create one with a timestamped filename if none exists).
2. **Never** execute migrations yourself — no db push, no direct `psql`/CLI
   shells, no MCP execute-SQL calls against any database.
3. In the final response, include one complete raw SQL code block containing
   the full executable migration, ready to paste directly into Neon SQL Editor
   and run. Never make the user open the migration file, reconstruct fragments,
   or translate ORM code. Also include the file path and a one-line summary.
4. Migrations must be idempotent where practical (`IF NOT EXISTS` /
   `IF EXISTS`) and never destructive without an explicit warning called out to
   the user.

## 4. Feature placement — public, private, or mixed (decide EVERY time)

Thally has three repositories with different deployed artifacts:

- **`thally`** (public, MIT) — the engine, runtime, shared packages, and free
  tier. It is the only authored source for runtime-owned files.
- **`starter`** (public) — the complete customer-ready site tree used by Cloud,
  CLI, MCP, and migration. Its runtime-owned paths are generated from one exact
  `thally` commit; template content and defaults are authored here.
- **`thally-cloud`** (this repository, private) — the hosted control plane,
  paid services, and managed workers. It tracks `thally` as `upstream`, but the
  two root applications are not interchangeable.

Before placing any change, trace the real entrypoint through code to the
artifact it creates or deploys and confirm the boundary in `ARCHITECTURE.md`.
Do not infer ownership from a repository name or a planning note.

`ARCHITECTURE.md` is the sole architectural authority. Proposed changes and
their validated blast radius live in `PLATFORM-HARDENING-PLAN.md`; they do not
describe current production behavior until their exit gate is complete and the
architecture document is updated.

For **every** feature or fix, decide the placement before writing code, and
apply the change to the right repo(s):

- **Public-only** — engine work (content pipeline, rendering, search, SEO
  surfaces, CLI/MCP/agent packages, free admin panels). Author it once in
  `thally`; the starter synchronization workflow generates the standalone
  snapshot and proves byte-for-byte parity.
- **Starter-only** — customer-facing seed content, portable defaults, and
  template packaging that are not runtime behavior. Land these in `starter`.
- **Private-only** — paid service internals (Track pipeline, AI answers
  serving, analytics, control plane, billing). Land it ONLY in `thally-cloud`,
  inside `src/cloud/` (or the control-plane app). Never let it touch the
  public repo.
- **Mixed (upsell)** — a paid feature with a visible free surface: the locked
  panel / route shell / bridge-interface change is public; the service
  implementation is private. Extend `src/lib/cloud-bridge/types.ts` in the
  PUBLIC repo (the contract is public by design), implement in the private
  one, and keep both sides building against the same contract version.

After public changes that touch the bridge contract or a shared package, sync
the relevant public changes into `thally-cloud` and run its full test suite in
the same working session. Never merge the public and private root applications
as though they were the same artifact. Engine-side code never imports
`src/cloud` except through the bridge.

## 5. Project conventions

- **TypeScript everywhere**; functional and declarative patterns, no classes.
  Prefer interfaces over types; no enums (use maps). Descriptive names with
  auxiliary verbs (`isLoading`, `hasError`).
- **Comment generously for maintainers** — this is an open-source codebase
  read by strangers. Every module gets a header comment explaining its role
  and invariants; exported functions get JSDoc; non-obvious decisions get a
  "why" comment (constraints, gotchas, failure contracts — e.g. "never 5xx,
  GitHub auto-disables failing hooks"). Explain intent, not mechanics; never
  narrate what the next line does.
- **Respect the ownership model:** users author content and config
  (`src/content/`, `docs.json`, `src/data/site.ts`,
  `src/mdx/custom-components.tsx`); the framework is a hidden runtime. New
  config goes in `docs.json` / `site.ts` / `THALLY_*` env vars (each read keeps
  its legacy `DOX_*` fallback) — never require editing Next.js internals.
- **Single source of truth:** the structured content representation drives all
  projections (HTML, JSON, JSON-LD, Markdown, embeddings). Never parse content
  twice with different code paths.
- **Engine ↔ cloud boundary:** cloud-tier services (Track, AI answers,
  analytics) live in `src/cloud/` and are reachable from engine code ONLY via
  `@/lib/cloud-bridge` — an ESLint rule enforces this. Every consumer must
  handle the service being absent (locked panel / hidden widget / silent
  no-op): the OSS distribution ships `src/cloud/` as a no-op stub. See
  `ARCHITECTURE.md`.
- **Middleware caution:** `src/middleware.ts` must preserve the RSC-header
  bypasses (`rsc`, `next-router-state-tree`, `next-router-prefetch`) — breaking
  client-side navigation is a known pitfall. Add headers, never rewrites, on
  doc pages.
- **Tests:** unit tests live next to existing suites (`src/lib/__tests__/`,
  `src/cloud/*/__tests__/`, `packages/mcp/src/__tests__/`). Match validation to
  the risk and scope of the change; run `npm test` and `thally check` for
  substantive behavioral or cross-cutting work, not routine copy or cosmetic
  edits. Middleware changes require RSC-navigation regression tests.
- **New env vars** are always optional with safe defaults, documented in
  `.env.example` and the README table.
- **Every runtime feature ships into scaffolded sites:** author it in `thally`,
  generate the `starter` snapshot, verify parity and a real
  `create-thally-docs` output, then add CLI/MCP affordances and docs where
  relevant. Never hand-apply the same runtime fix in both repositories.

## Important

# CLAUDE.md

Instructions for Claude when working in this repository (Thally — an
agent-native documentation platform: a Next.js template plus the `thally`
toolchain in `packages/{agent,cli,create-thally-docs,mcp}`).

## 1. Skills first — check before every task

On **every** prompt, before writing any code or hand-rolling a solution:

1. Check **project-scoped skills** in `.claude/skills/`.
2. Check **global skills** in `~/.claude/skills/`.
3. If a skill is relevant to the task, read its `SKILL.md` and follow it.
4. Only when no relevant skill exists may you hand-roll the solution.

Do not skip this check because the task looks simple. If multiple skills apply,
prefer the project-scoped one.

## 2. Git — never commit or push yourself

You must **never** run `git commit` or `git push` (or any command that writes to
GitHub), even when the user asks you to "commit and push" — those are the actions
that stamp attribution into the user's history, and the user runs them himself.

**Every other git action is allowed.** `git add`, `git rm`, `git mv`,
`git checkout`, `git stash`, branch operations, and read-only `status`/`log`/
`diff` are all fine during normal work. The rule is about attribution in the
commit history, not about touching git.

Instead, when the user asks to commit and/or push:

1. Do not commit or push it yourself — hand the user the commands to run.
2. Write the exact commands as a single copy-paste-able block that the user
   executes themselves, for example:

   ```bash
   git add src/lib/foo.ts src/lib/__tests__/foo.test.ts && \
   git commit -m "fix: handle empty search corpus in hybrid mode" && \
   git push origin <branch>
   ```

3. The commit message must contain **no attribution of any kind** — never
   `Co-Authored-By: Claude`, never "Generated with Claude Code", no emoji
   badges, no AI attribution trailers. A plain conventional-commit message
   only.
4. **Write for an open-source audience.** Thousands of people will read this
   history. Subject ≤ 72 chars; the body carries only what a maintainer needs
   to understand the change (the what and the why). No housekeeping trivia
   (e.g. "delete stray dir"), no process narration, no verification logs.
5. List the files intended for the commit so the user can verify the staging
   list before running it.

## 3. Database migrations — write, never execute

For any database schema change (local libSQL/Turso today; the Thally Cloud
Postgres when it exists):

1. Write the migration as a plain `.sql` file in the project's migrations
   directory (create one with a timestamped filename if none exists).
2. **Never** execute migrations yourself — no db push, no direct `psql`/CLI
   shells, no MCP execute-SQL calls against any database.
3. In the final response, include one complete raw SQL code block containing
   the full executable migration, ready to paste directly into Neon SQL Editor
   and run. Never make the user open the migration file, reconstruct fragments,
   or translate ORM code. Also include the file path and a one-line summary.
4. Migrations must be idempotent where practical (`IF NOT EXISTS` /
   `IF EXISTS`) and never destructive without an explicit warning called out to
   the user.

## 4. Feature placement — public, private, or mixed (decide EVERY time)

Thally has three repositories with different deployed artifacts:

- **`thally`** (public, MIT) — the engine, runtime, shared packages, and free
  tier. It is the only authored source for runtime-owned files.
- **`starter`** (public) — the complete customer-ready site tree used by Cloud,
  CLI, MCP, and migration. Its runtime-owned paths are generated from one exact
  `thally` commit; template content and defaults are authored here.
- **`thally-cloud`** (this repository, private) — the hosted control plane,
  paid services, and managed workers. It tracks `thally` as `upstream`, but the
  two root applications are not interchangeable.

Before placing any change, trace the real entrypoint through code to the
artifact it creates or deploys and confirm the boundary in `ARCHITECTURE.md`.
Do not infer ownership from a repository name or a planning note.

For **every** feature or fix, decide the placement before writing code, and
apply the change to the right repo(s):

- **Public-only** — engine work (content pipeline, rendering, search, SEO
  surfaces, CLI/MCP/agent packages, free admin panels). Author it once in
  `thally`; the starter synchronization workflow generates the standalone
  snapshot and proves byte-for-byte parity.
- **Starter-only** — customer-facing seed content, portable defaults, and
  template packaging that are not runtime behavior. Land these in `starter`.
- **Private-only** — paid service internals (Track pipeline, AI answers
  serving, analytics, control plane, billing). Land it ONLY in `thally-cloud`,
  inside `src/cloud/` (or the control-plane app). Never let it touch the
  public repo.
- **Mixed (upsell)** — a paid feature with a visible free surface: the locked
  panel / route shell / bridge-interface change is public; the service
  implementation is private. Extend `src/lib/cloud-bridge/types.ts` in the
  PUBLIC repo (the contract is public by design), implement in the private
  one, and keep both sides building against the same contract version.

After public changes that touch the bridge contract or a shared package, sync
the relevant public changes into `thally-cloud` and run its full test suite in
the same working session. Never merge the public and private root applications
as though they were the same artifact. Engine-side code never imports
`src/cloud` except through the bridge.

## 5. Project conventions

- **TypeScript everywhere**; functional and declarative patterns, no classes.
  Prefer interfaces over types; no enums (use maps). Descriptive names with
  auxiliary verbs (`isLoading`, `hasError`).
- **Comment generously for maintainers** — this is an open-source codebase
  read by strangers. Every module gets a header comment explaining its role
  and invariants; exported functions get JSDoc; non-obvious decisions get a
  "why" comment (constraints, gotchas, failure contracts — e.g. "never 5xx,
  GitHub auto-disables failing hooks"). Explain intent, not mechanics; never
  narrate what the next line does.
- **Respect the ownership model:** users author content and config
  (`src/content/`, `docs.json`, `src/data/site.ts`,
  `src/mdx/custom-components.tsx`); the framework is a hidden runtime. New
  config goes in `docs.json` / `site.ts` / `THALLY_*` env vars (each read keeps
  its legacy `DOX_*` fallback) — never require editing Next.js internals.
- **Single source of truth:** the structured content representation drives all
  projections (HTML, JSON, JSON-LD, Markdown, embeddings). Never parse content
  twice with different code paths.
- **Engine ↔ cloud boundary:** cloud-tier services (Track, AI answers,
  analytics) live in `src/cloud/` and are reachable from engine code ONLY via
  `@/lib/cloud-bridge` — an ESLint rule enforces this. Every consumer must
  handle the service being absent (locked panel / hidden widget / silent
  no-op): the OSS distribution ships `src/cloud/` as a no-op stub. See
  `ARCHITECTURE.md`.
- **Middleware caution:** `src/middleware.ts` must preserve the RSC-header
  bypasses (`rsc`, `next-router-state-tree`, `next-router-prefetch`) — breaking
  client-side navigation is a known pitfall. Add headers, never rewrites, on
  doc pages.
- **Tests:** unit tests live next to existing suites (`src/lib/__tests__/`,
  `src/cloud/*/__tests__/`, `packages/mcp/src/__tests__/`). Run `npm test`
  (vitest) and `thally check` before declaring work done. Middleware changes
  require RSC-navigation regression tests.
- **New env vars** are always optional with safe defaults, documented in
  `.env.example` and the README table.
- **Every runtime feature ships into scaffolded sites:** author it in `thally`,
  generate the `starter` snapshot, verify parity and a real
  `create-thally-docs` output, then add CLI/MCP affordances and docs where
  relevant. Never hand-apply the same runtime fix in both repositories.

## Important

Run code review and security review after every goal accomplishment or feature implementation before calling it done. You have to be thoughtful about it though, if you have a series of tasks leading into a certain goal of feature do not run code review and security review individually on the tasks until done. That wa you don't burn tokens on every little fix
