# Dox → Thally Rebrand — Complete Surface Inventory

Compiled 2026-07-11 on branch `worktree-thally-rebrand`. Basis: four parallel
exhaustive sweeps (app runtime, toolchain packages, content/config, external
contracts) over the whole repo excluding `node_modules`, `.next`, `.git`.

**Scope:** 216 files, ~1,586 case-insensitive `dox` mentions. Zero false
positives — no `paradox`/`sandbox`-style collisions; every hit is brand.

**npm availability (checked 2026-07-11):** `thally`, `create-thally`,
`thally-mcp`, `@thallylabs/{cli,mcp,agent}` are all unclaimed (404).
Currently published Dox packages: `create-dox@0.6.0`, `@doxlabs/mcp@0.6.0`,
`@doxlabs/cli@0.4.0`. `@doxlabs/agent` is private/unpublished. Note: bare
`dox` on npm is an unrelated third-party package (was never ours).

---

## A. Decisions required before mechanical work starts

These block the rename fan-out; everything downstream keys off them.

1. **npm naming scheme** — proposed: `@thallylabs/cli` (bin `thally`),
   `create-thally` (bin `create-thally`), `@thallylabs/mcp` (bin
   `thally-mcp`), `@thallylabs/agent`. The `@thallylabs` npm org must be
   created before publish. Old packages need `npm deprecate` pointers.
2. **GitHub repo rename** — `kenny-io/Dox` → e.g. `kenny-io/thally`.
   Determines the codeload tarball URL (`create-dox` downloads the template
   from `https://codeload.github.com/kenny-io/Dox/tar.gz/main`), all
   footer/support links, `npx degit` instructions, package.json
   repository/homepage/bugs fields. GitHub auto-redirects renamed repos, but
   tarball URLs in published old package versions keep working only via that
   redirect.
3. **Env var policy** — rename all 43 `DOX_*` vars to `THALLY_*` with
   back-compat fallback reads (`THALLY_X ?? DOX_X`), or clean break? A
   fallback shim keeps existing deployments alive; recommended.
4. **Public URL** — `/guides/dox-track` → `/guides/thally-track` needs a
   redirect entry so old links keep resolving.
5. **Feature names** — "Dox Track" → "Thally Track", "DoxAI" → "ThallyAI"
   (or a new AI-assistant name), "Dox docs agent" → "Thally docs agent".
6. **Social/community handles** — `twitter.com/doxdocs`, `discord.gg/dox`
   in `docs.json`: real new handles or placeholders?
7. **Persisted-state migration** — cookies, localStorage key, analytics
   `agent_signal` value, `.data/dox.db`, `.dox/embeddings` cache: rename with
   migration/fallback, or accept one-time invalidation (logged-out admins,
   re-shown banner, split analytics series)?
8. **GitHub external contract compat** — the `dox-document` dispatch event,
   `@dox` comment trigger, `dox/agent-` branch prefix, and `dox-*.yml`
   workflow filenames live in *users'* repos (scaffolded there by us).
   Renaming them breaks every existing Track installation unless the webhook
   handler and loop guard accept both old and new values during a transition.

---

## B. Surface inventory

### B1. Package identities (npm — external contract)

| Current | File | Notes |
|---|---|---|
| `dox` (root, private) | `package.json:2` | monorepo name; scripts reference workspace paths `packages/create-dox` etc. |
| `@doxlabs/cli`, bin `dox` | `packages/cli/package.json` | published; bundles `@doxlabs/agent` (`packages/cli/tsup.config.ts:13`) |
| `create-dox`, bin `create-dox` | `packages/create-dox/package.json` | published; **directory name is also branded** |
| `@doxlabs/mcp`, bin `dox-mcp` | `packages/mcp/package.json` | published; subpath exports `@doxlabs/mcp/tools`, `@doxlabs/mcp/track`; `server.ts:9-10` advertises name `@doxlabs/mcp` version `0.3.0` (stale vs pkg 0.6.0) |
| `@doxlabs/agent` | `packages/agent/package.json` | private, not published |
| `create-dox@0.2.0`, bin `create-dox` | `cli/package.json` (top-level `cli/` dir) | **legacy duplicate scaffolder** (`cli/src/index.js` + committed `cli/dist/`); git-clones `kenny-io/Dox.git`. Candidate for deletion instead of rename |

Cross-references: root `package.json` depends on `@doxlabs/mcp: *`; app code
imports `@doxlabs/mcp` / `@doxlabs/mcp/track` in ~21 places (`src/lib/tasks.ts`,
`src/lib/track/webhook.ts`, `src/lib/track/github-app.ts`,
`src/app/api/admin/github-app/callback/route.ts`, `packages/agent/src/scaffold.ts`, …).
All package.json `keywords` arrays contain `"dox"`; repository/homepage/bugs
URLs point at `kenny-io/Dox`.

### B2. CLI command surface (what users type — external contract)

- Bins: `dox`, `create-dox`, `dox-mcp`.
- `dox` subcommands (usage strings in `packages/cli/src/router.ts:21-32`):
  `init, dev, build, start, deploy, check, new, migrate, translate, mcp,
  agent, track` — all help text prefixed `dox `.
- `create-dox` subcommands: `migrate`, `check`, `translate`
  (`packages/create-dox/src/index.ts:39,145`).
- Help/log strings with "Dox" brand: `packages/cli/src/index.ts:11,17`,
  `commands/new-page.ts:37`, `commands/agent.ts:82`,
  `commands/track.ts:114,178,180,230`; `packages/create-dox/src/index.ts:76,158`,
  `utils.ts:40-55` (ASCII-art **DOX** banner + "Your Dox project is ready!"),
  `check.ts:227,353`, `prompts.ts:81-95`, `scaffold.ts:60-62`;
  `packages/mcp/src/index.ts:7`, tools' output strings;
  `packages/agent/src/prompt.ts:6` ("You are the Dox documentation agent"),
  `run.ts:110-111` (PR body "Drafted by the Dox docs agent"), `git.ts:22,25`.
- Documented `npx` commands across README + docs content:
  `npx create-dox`, `npx dox agent`, `npx dox check`,
  `npx --yes create-dox@latest check --ci .`, `npx degit kenny-io/Dox`.

### B3. MCP surface (agent-facing contract)

- Local package server name `@doxlabs/mcp` (`packages/mcp/src/server.ts:9`);
  client registration key `dox` (`packages/mcp/README.md:13,21-23`).
- Hosted MCP route server identity `dox-docs`
  (`src/app/api/mcp/route.ts:19`,
  `src/app/api/well-known/[...document]/route.ts:75`) — users copy
  `claude mcp add --transport http dox-docs …` snippets from
  `src/components/admin/mcp-view.tsx:75-88`.
- 14 tool names are generic snake_case (no dox token) — safe; but ~25 tool
  *descriptions* say "Dox project" (`packages/mcp/src/lib/tools.ts` and
  every `packages/mcp/src/tools/*.ts` `.describe()`).
- Well-known JSON-LD strings: "Dox documentation MCP server", "Dox Docs
  Agent", "Dox documentation" (`well-known/[...document]/route.ts:76,112,147,195,276`).

### B4. Environment variables (43 distinct `DOX_*` — deployment contract)

Full list with read locations (from the external-contracts sweep):

- **App runtime (29):** `DOX_SITE_URL` (site-url.ts, og.ts, site.ts,
  llms.txt route, deploy.ts, ci.yml), `DOX_AUTH_SECRET` (~27 refs: session,
  admin secrets/settings, github-app, chat-access, track setup),
  `DOX_ADMIN_PASSWORD`, `DOX_ADMIN_SECRET`, `DOX_ACCESS_PASSWORD`,
  `DOX_ANALYTICS_SECRET`, `DOX_ANALYTICS_DB_URL/_TOKEN`,
  `DOX_DATABASE_URL/_TOKEN`, `DOX_STORAGE`, `DOX_OIDC_ISSUER/_CLIENT_ID/_CLIENT_SECRET`,
  `DOX_EMBEDDING_PROVIDER/_MODEL/_DIMENSIONS/_API_KEY`, `DOX_CHAT_INSIGHTS`,
  `DOX_TRIAL_ANTHROPIC_KEY`, `DOX_CHAT_RATE_PER_MIN/_PER_DAY`,
  `DOX_TRIAL_RATE_PER_MIN/_PER_DAY/_DAILY_LIMIT`, `DOX_MCP_RATE_PER_MIN`,
  `DOX_REPO_URL`, `DOX_TRACK_WEBHOOK_SECRET`.
- **Toolchain/workflows (14):** `DOX_GITHUB_TOKEN`, `DOX_TASKS_TOKEN`,
  `DOX_GITHUB_APP_ID/_INSTALLATION_ID/_PRIVATE_KEY`, `DOX_DISPATCH_TOKEN`,
  `DOX_AGENT_TOKEN`, `DOX_AGENT_MODEL`, `DOX_PR_URL`, `DOX_PR_NUMBER`
  (+ template placeholder `__DOX_PR_NUMBER__`), `DOX_REQUESTER`, `DOX_MERGED`.
- Several are **user-set repo/deployment secrets** stamped into scaffolded
  workflows: `DOX_AGENT_TOKEN`, `DOX_DISPATCH_TOKEN`, `DOX_GITHUB_TOKEN`,
  `DOX_TRACK_WEBHOOK_SECRET`, `DOX_SITE_URL`, `DOX_AUTH_SECRET`.
- Documented in `.env.example` (header "# Dox environment variables") and
  `README.md:156-165` table.
- Legacy fallback `NEXT_PUBLIC_SITE_URL` (not branded, keep).
- Dev fallback value `'dox-dev-admin'` (`src/lib/admin/auth-edge.ts:7`).

### B5. HTTP headers & API contracts

| Token | Files | Risk |
|---|---|---|
| `x-dox-client` (inbound, agents self-identify) | `src/lib/traffic-classifier.ts:9,28,55-75` | **external agents send this**; enum value `x_dox_client` persisted in analytics `agent_signal` column — renaming splits historical series |
| `x-dox-format` / `Vary: Accept, X-Dox-Format` | `src/middleware.ts:210`, `src/app/api/docs/[...slug]/route.ts:36,127` | Vary is a **CDN cache-key contract** |
| `x-dox-ai-tier` (response) | `src/app/api/chat/route.ts:135,264` | client-visible |
| `X-Dox-Site-Url-Warning` | `src/app/llms.txt/route.ts:83` | diagnostic |
| `x-dox-analytics-secret` (internal middleware→collect) | `src/middleware.ts:110`, `src/app/api/analytics/collect/route.ts:10` | must flip both ends together |
| `repository_dispatch` `event_type: 'dox-document'` | `src/lib/track/webhook.ts:189`, `src/lib/admin/dispatch-agent.ts:93`, `packages/agent/src/scaffold.ts:16,108,138,222`, `packages/mcp/src/tools/sync-from-repo.ts:115`, `.github/workflows/dox-agent.yml` | **breaks every existing Track install** if renamed without dual-accept |
| MCP server id `dox-docs` | see B3 | user MCP configs |
| OIDC redirect `/api/admin/auth/callback` | path unbranded; env names are | provider re-registration only if env renamed without shim |

### B6. Browser/persisted state (renames invalidate user state)

- Cookies: `dox_admin_id` (`src/lib/auth/session.ts:5`), `dox_oidc_flow`
  (`session.ts:48`), `dox_admin_session`, `dox_docs_access`
  (`src/lib/admin/auth-edge.ts:3-4`); consumed in `src/middleware.ts:130-158`
  and the admin/access auth routes. Rename = all sessions invalidated.
- localStorage: `dox-banner-dismissed`
  (`src/components/layout/site-banner.tsx:11,21,31`).
- On-disk: `.data/dox.db` default (`src/lib/storage/index.ts:6`),
  `.dox/embeddings` cache dir (`src/lib/embeddings/index-store.ts:10`).
- Analytics DB value `x_dox_client` (see B5). Table names themselves
  (`storage_kv`, `analytics_events`, …) are unbranded — no change.
- Runtime regexes matching PR-body text "Drafted by the Dox docs agent"
  (`src/lib/tasks.ts:39,93`) — soft contract with historical PRs.

### B7. GitHub integration

- **Committed workflows** (`.github/workflows/`): `dox-check.yml` (job
  `dox check`, concurrency group `dox-check-…`, runs
  `npx --yes create-dox@latest check --ci .`), `dox-agent.yml` (name
  "Dox docs agent", `types: [dox-document]`, git author
  `dox-agent <dox-agent@users.noreply.github.com>`, secrets
  `DOX_AGENT_TOKEN`/`DOX_GITHUB_TOKEN`), `ci.yml` (`DOX_SITE_URL`).
- **Workflow templates emitted into users' repos**
  (`packages/agent/src/scaffold.ts:11,87,120,187`): "Dox docs agent",
  "Dox mention" (trigger prefix `@dox`, strip `${INSTRUCTION#@dox }`),
  "Dox merge dispatch", "Dox track dispatch" (loop guard
  `!startsWith(head.ref, 'dox/agent-')`). Generated filenames:
  `dox-agent.yml` (`scaffold.ts:254`), `dox-mention.yml`
  (`cli/commands/agent.ts:22`), `dox-track.yml`,
  `dox-track-sender-${repo}.yml` (`cli/commands/track.ts:209,213`).
- **GitHub App**: manifest default name `'Dox Track'`
  (`src/lib/track/github-app.ts:38`); example slug `acme-dox-track`
  (`src/lib/admin/settings.ts:46`, tests); UI copy "your own Dox app"
  (`src/components/admin/github-connect-panel.tsx:120`). Existing installed
  apps keep their name — rename only affects newly created apps.
- **Branch prefix**: `AGENT_BRANCH_PREFIX = 'dox/agent-'`
  (`packages/mcp/src/lib/track.ts:22`), consumed by
  `src/lib/track/webhook.ts:84,95`, `packages/agent/src/run.ts:37`, scaffolded
  workflows, tests.
- Log tags `[dox-track]` (`packages/mcp/src/lib/track.ts:197`), `[dox]`
  (`src/lib/site-url.ts`, `scripts/build-embeddings.ts`).
- `.github/ISSUE_TEMPLATE/bug_report.md:22` — "Dox version:" field.
- Scaffold exclusion list `/dox-agent.yml`, `/dox-track.yml`
  (`packages/create-dox/src/download.ts:15-31`) + hygiene tests.

### B8. Template download / scaffold output (stamped into users' projects)

- Tarball `https://codeload.github.com/kenny-io/Dox/tar.gz/main` —
  `packages/create-dox/src/download.ts:7` AND duplicated in
  `packages/mcp/src/lib/scaffold.ts:20`; tarball entries `Dox-main/…`
  (hygiene test fixtures).
- Starter content "powered by [Dox](https://github.com/kenny-io/Dox)" —
  `packages/create-dox/src/customize.ts:19-22,87`,
  `packages/mcp/src/lib/scaffold.ts:31`, `cli/src/index.js:28`.
- Stamped commit message "Initial commit from create-dox" —
  `create-dox/src/utils.ts:23`, `mcp/src/lib/scaffold.ts:275`,
  `mcp/src/lib/migrate/index.ts:92`.
- `docs.json` tracking-block reset so scaffolds don't inherit `kenny-io/Dox`
  (`create-dox/src/docs-json.ts:49-72`).
- Temp dir prefixes `dox-migrate-` (`create-dox/src/migrate/index.ts:132`,
  `mcp/src/lib/migrate/index.ts:124`), `dox-scaffold-` (tests only).

### B9. CSS namespace (internal, but definition + usage must flip atomically)

- **Custom properties** (7): `--dox-background/-foreground/-muted/-border/`
  `-accent/-accent-foreground/-ring` — defined `src/app/globals.css:43-49,69-75`;
  consumed in `tailwind.config.ts:36-73`, `globals.css` (multiple),
  `src/styles/design-system.css:23,42,48,263,266`.
- **Classes**: `.dox-dashboard` (~232 selector prefixes in
  `src/styles/design-system.css`; applied in
  `src/components/admin/admin-shell.tsx:97,112`); `.dox-nav-tab-*`
  (`globals.css:128` + `top-bar.tsx:149-158`); `.dox-steps/.dox-step*`
  (`globals.css:134` + `components/mdx/steps.tsx`); `.dox-line-highlight`
  (`globals.css:140` + emitted by `src/mdx/rehype.ts:105`);
  `.dox-accordion-content` (+ `components/mdx/accordion.tsx:34`);
  `.dox-ink-banner*` (`globals.css:180-243` + `site-banner.tsx:38-52`);
  `.dox-sidebar-indicator` (`navigation/sidebar.tsx:92`).
- **Keyframes**: `dox-accordion-down/up` (`globals.css:150-162`).

### B10. UI strings, metadata, brand assets

- `src/data/site.ts:144-151`: `name: 'Dox'`, description "Dox is the first
  agent-native documentation platform…", GitHub/support links; comment `:87`.
  Flows into titles, OpenGraph, JSON-LD.
- `docs.json`: banner "**Dox** v2 is coming" (`:4`), `ai.label: "DoxAI"`
  (`:9`), navbar/footer GitHub links (`:27,38`), `twitter.com/doxdocs`
  (`:39`), `discord.gg/dox` (`:40`), nav page `guides/dox-track` (`:234`),
  `tracking.repos[0] = kenny-io/Dox` (`:342-343`).
- Admin UI: `admin-login-form.tsx:8` (`siteName = 'Dox'`),
  `settings-view.tsx:87,114,146`, `github-connect-panel.tsx:22,97,118,120`,
  `tasks-view.tsx:53,122,123`, `admin-settings-controls.tsx:181,408`,
  `mcp-view.tsx:75-88`, `brand-mark.tsx:12,24,25`.
- Agent manifest text (`src/lib/agent-manifest.ts:45,55,71`): "This is a Dox
  project…", "`dox check`", "`dox agent`".
- Changelog RSS (`src/app/changelog/rss.xml/route.ts:19`).
- **Assets on disk** (`public/brand/`): `dox-logo-light.png`,
  `dox-logo-dark.png`, `dox-favicon-light.png`, `dox-favicon-dark.png` —
  referenced from `src/components/layout/logo.tsx:56`,
  `src/components/admin/brand-mark.tsx:24,25`,
  `src/app/api/brand/favicon/route.ts:18`. New Thally logo/favicon art
  needed (or renamed placeholders).

### B11. Docs content (copy rewrite)

- **62 MDX files** mention Dox: 35 English (`src/content/` root +
  `guides/`), 27 Spanish (`src/content/es/…`). Highest density:
  `guides/cli-reference.mdx` (32 en + 32 es), `guides/dox-track.mdx` (26),
  `guides/deploying.mdx` (23 + 11), `guides/mcp-server.mdx` (23 + 19),
  `guides/migrating.mdx` (20 + 20), `admin-dashboard.mdx` (17),
  `docs-agent.mdx` (16), `multi-language.mdx` (15 + 10),
  `showcase.mdx` (11 + 11), `introduction.mdx` (10 + 12),
  `ai-features.mdx` (10 + 3). Full per-file table in the sweep output.
- **Slug rename**: only `/guides/dox-track` → file
  `src/content/guides/dox-track.mdx` (no es translation of this guide).
  Cross-referenced from `changelog.mdx:15`, `introduction.mdx:35`,
  `admin-dashboard.mdx:15,147`, `deploying.mdx:33,36`, `docs-agent.mdx:109`,
  itself `:95`, `docs.json:234`, `.env.example:55`,
  `settings-view.tsx:146`, `packages/create-dox/src/scaffold.ts:62`.
- `DoxAI` appears in `docs.json:9` and
  `guides/seo-and-visibility.mdx:70` (en + es).
- Clone/degit instructions `kenny-io/Dox(.git)` in `introduction.mdx:70`,
  `guides/getting-started.mdx:45` (en + es), `README.md:36`.

### B12. Root docs & internal notes

- `README.md`: title, taglines, feature bullets (`dox agent`, `@dox`,
  `dox check --drift`, `@doxlabs/mcp`), quick start, env-var table.
- `.env.example`: header + all `DOX_*` vars + "Dox Track" section +
  `.data/dox.db` hint.
- `CLAUDE.md` (repo root): describes "the `dox` toolchain", `dox check`,
  `DOX_*` env vars.
- `notes/product-principles.md` (16), `notes/design-system.md` (12,
  documents `.dox-dashboard` scope), `notes/dox-v2-plan.md`,
  `notes/dox-v2-updated-plan.md` (branded filenames), `src/phase1plan.md` (23).
- LICENSE: no Dox string (copyright "Ekene Eze") — no change.

### B13. Internal identifiers (safe mechanical renames)

- Functions/ids: `isDoxProject()` (`packages/cli/src/process.ts:31`),
  `mapAdmonitionToDoxTag`, `mapGitBookStyleToDoxTag` (importer in both
  create-dox and mcp), nav-builder source id `'dox'` / label `'Dox'`
  (`nav-builder.ts` in both packages), `AGENT_BRANCH_PREFIX`,
  `SESSION_COOKIE`-style consts (values covered above).
- Version drift bug found during sweep: `packages/mcp/src/server.ts:10`
  hardcodes `version: '0.3.0'` while the package is 0.6.0 — fix while renaming.
- Tests with dox fixtures: `packages/create-dox/src/__tests__/scaffold-hygiene.test.ts`,
  `packages/mcp/src/__tests__/track.test.ts`,
  `packages/agent/src/__tests__/track-guards.test.ts`,
  `src/lib/track/__tests__/webhook.test.ts`,
  `src/lib/track/__tests__/github-app.test.ts`, `src/lib/__tests__/site-url.test.ts`.

---

## C. Risk register (things that break outside this repo)

| Rename | Breaks | Mitigation |
|---|---|---|
| `DOX_*` env vars | every existing deployment | dual-read shim `THALLY_X ?? DOX_X` for ≥1 release |
| Cookies `dox_*` | live admin sessions, docs-access gates | accept logout, or dual-read cookie for a transition |
| `dox-document` event / `@dox` trigger / `dox/agent-` prefix / `dox-*.yml` filenames | all existing Dox Track installs (files live in users' repos) | webhook + loop guard accept both values; scaffold emits new names |
| `create-dox`/`@doxlabs/*` npm names | `npx create-dox` users, old tutorials | publish new names, `npm deprecate` old ones with pointer message |
| Codeload tarball `kenny-io/Dox` | old published create-dox versions scaffolding | GitHub repo rename keeps redirects; do repo rename, don't delete |
| `Vary: X-Dox-Format` | CDN cache keys | send both headers briefly or accept one-time cache churn |
| `x-dox-client` header + `x_dox_client` analytics value | agent integrations, historical analytics continuity | classifier accepts both header names; keep stored enum or map old→new in aggregation |
| `/guides/dox-track` URL | inbound links, scaffold pointer text | redirect entry |
| `.data/dox.db`, `.dox/embeddings` | local dev state only | fall back to old path if new one absent, or ignore |
| `dox_admin_id` OIDC flow | in-flight OIDC logins | trivial, accept |

---

## D. Candidate parallel workstreams (input to the delegation plan)

Naming decisions (§A) must land first; after that these are largely
independent, with the noted seams:

1. **W1 — packages/create-dox** (dir rename, pkg name, bins, tarball URL,
   scaffold output, prompts, ASCII banner, tests).
2. **W2 — packages/mcp** (pkg name, `dox-mcp` bin, server name, tool
   descriptions, scaffold/track libs incl. `AGENT_BRANCH_PREFIX` +
   compat, tarball URL dup, version-drift fix, tests).
3. **W3 — packages/cli + packages/agent + legacy `cli/`** (pkg names, `dox`
   bin, router help text, track/agent commands, workflow templates emitted
   into user repos, prompt.ts, delete or rename legacy `cli/`).
4. **W4 — app runtime: env vars + auth/state** (THALLY_* with DOX_ fallback
   shim, cookies, localStorage, `.dox/` + `dox.db` paths, `dox-dev-admin`).
5. **W5 — app runtime: HTTP/MCP/track contracts** (x-dox-* headers with
   dual-accept, traffic classifier, `dox-docs` MCP identity, dispatch event
   compat, GitHub App manifest name, webhook loop guard).
6. **W6 — CSS + visual identity** (`--dox-*` vars, `.dox-*` classes,
   keyframes, `.dox-dashboard` namespace, `tailwind.config.ts`,
   `public/brand/` asset filenames + references; needs new logo art).
7. **W7 — UI strings & metadata** (site.ts, docs.json, admin components,
   agent-manifest, RSS, login form).
8. **W8 — English content** (35 MDX files, slug rename + redirect,
   cross-refs).
9. **W9 — Spanish content** (27 MDX files, mirrors W8).
10. **W10 — repo meta** (README, .env.example, CLAUDE.md, .github workflows
    + templates, notes/, phase1plan, root package.json name/scripts).

Seams to coordinate: workspace import specifiers (`@doxlabs/mcp` used by app
code — W2×W4/W5), `/guides/dox-track` slug (W8×W7×W10×W1),
`AGENT_BRANCH_PREFIX`/dispatch-event compat (W2×W3×W5), env-var shim used by
both app and packages (W4×W3), scaffold exclusion list naming (W1×W10).
Post-rename gates: `npm test`, `npm run build`, `dox check`, scaffold
hygiene tests, RSC-navigation regression, npm org creation + publishes,
GitHub repo rename.
