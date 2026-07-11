# Dox → Thally Rebrand — Delegation Plan

Companion to `notes/thally-rebrand-surfaces.md`. All work happens on branch
`worktree-thally-rebrand` in this worktree.

## 0. Resolved decisions (2026-07-11)

1. **npm**: `@thallylabs/*` scope; CLI package `@thallylabs/cli` with bare
   bin `thally`; `create-dox` → `create-thally-docs` (bin `create-thally-docs`;
   amended 2026-07-11 from the original `create-thally` — "create thally docs"
   reads intuitively where bare `create-thally` didn't);
   `@doxlabs/mcp` → `@thallylabs/mcp` (bin `thally-mcp`);
   `@doxlabs/agent` → `@thallylabs/agent`.
2. **Env vars**: rename to `THALLY_*`, every read keeps a `DOX_*` fallback:
   `process.env.THALLY_X ?? process.env.DOX_X`. Docs/`.env.example` mention
   only `THALLY_*`.
3. **GitHub contracts**: CLEAN BREAK. `dox-document` → `thally-document`,
   `@dox` → `@thally`, branch prefix `dox/agent-` → `thally/agent-`,
   workflow filenames `dox-*.yml` → `thally-*.yml`, bot identity
   `dox-agent` → `thally-agent`. No dual-accept.
4. **Repo**: target identity is `thallylabs/thally`. All GitHub URLs,
   tarball (`https://codeload.github.com/thallylabs/thally/tar.gz/main`),
   degit instructions, package.json repository/homepage/bugs fields point
   there. (Actual repo migration is a human/GitHub step, tracked in §4.)
5. **Names**: product "Thally"; features "Thally Track", "ThallyAI",
   "Thally docs agent". Socials: `twitter.com/thallydocs`,
   `discord.gg/thally` (placeholders until real handles exist).

Per-item defaults derived from the above (clean rename unless noted):
- Cookies → `thally_admin_id`, `thally_admin_session`, `thally_docs_access`,
  `thally_oidc_flow` (one-time logout accepted).
- localStorage → `thally-banner-dismissed` (banner re-shows once).
- Headers → `x-thally-client`, `x-thally-format`, `x-thally-ai-tier`,
  `x-thally-analytics-secret`, `X-Thally-Site-Url-Warning`; classifier enum
  value `x_thally_client`.
- Hosted MCP identity `dox-docs` → `thally-docs`; local MCP registration key
  `dox` → `thally`.
- Storage defaults → `.data/thally.db`, `.thally/embeddings`,
  dev fallback secret `thally-dev-admin`.
- Docs URL `/guides/dox-track` → `/guides/thally-track` **with redirect**
  from the old path (cheap; unrelated to the GitHub clean break).
- CSS namespace → `--thally-*`, `.thally-*`, `thally-accordion-up/down`.
- Temp dirs → `thally-migrate-`, `thally-scaffold-`; log tags `[thally]`,
  `[thally-track]`; identifiers `isThallyProject`, `map*ToThallyTag`, etc.
- Brand asset files → `public/brand/thally-{logo,favicon}-{light,dark}.png`
  (rename files + all references; new logo art is a follow-up, not blocking).
- Legacy top-level `cli/` directory: **deleted** (done 2026-07-11, ahead of
  the fan-out; it was not an npm workspace, nothing references it).
- `packages/mcp` version drift: **fixed** (done 2026-07-11) —
  `server.ts` now reads `name`/`version` from `package.json` via
  `createRequire`, so A2's package rename propagates automatically.

## 1. Global brand map (every agent applies this verbatim)

| Old | New |
|---|---|
| Dox / dox / DOX (word) | Thally / thally / THALLY |
| DoxAI | ThallyAI |
| Dox Track | Thally Track |
| doxlabs / @doxlabs | thallylabs / @thallylabs |
| kenny-io/Dox(.git) | thallylabs/thally(.git) |
| codeload.github.com/kenny-io/Dox/tar.gz/main | codeload.github.com/thallylabs/thally/tar.gz/main |
| `Dox-main/` (tarball entry prefix in tests) | `thally-main/` |
| DOX_&lt;VAR&gt; (read sites) | `THALLY_<VAR> ?? DOX_<VAR>` fallback read |
| DOX_&lt;VAR&gt; (docs, workflow secrets, emitted templates) | THALLY_&lt;VAR&gt; only |
| twitter.com/doxdocs, discord.gg/dox | twitter.com/thallydocs, discord.gg/thally |

Rules:
- Version bumps: minor bump each published package (`create-thally@0.7.0`,
  `@thallylabs/mcp@0.7.0`, `@thallylabs/cli@0.5.0`, `@thallylabs/agent@0.3.0`)
  — new-name first releases.
- The ONLY permitted surviving `dox` strings after the sweep:
  (a) `?? process.env.DOX_*` fallback reads and one `.env.example`/README
  note explaining legacy fallback, (b) the `/guides/dox-track` redirect
  source path, (c) git history/CHANGELOG-style prose describing the past.
- No attribution trailers in any commit message (repo rule; commits are run
  by the user anyway).

## 2. Agent workstreams (disjoint file ownership — safe to run in parallel)

### A1 — `packages/create-dox` → `packages/create-thally`
**Owns:** `packages/create-dox/**` (git mv to `packages/create-thally/`).
Package name/bin/keywords/repo fields; tarball URL; scaffold output strings
("powered by [Thally]", README stamp, commit message "Initial commit from
create-thally", ASCII banner **THALLY**, prompts, `✅ Your Thally project is
ready!`); `docs.json` tracking reset target; scaffold EXCLUDE_PATHS
(`/thally-agent.yml`, `/thally-track.yml`, keep excluding legacy `/cli/`,
`/packages/`); temp dir `thally-migrate-`; nav-builder id `'thally'`;
importer fn renames; all tests incl. `scaffold-hygiene.test.ts` fixtures
(`thally-main/…`, `thallylabs/thally`). Run its vitest suite.

### A2 — `packages/mcp`
**Owns:** `packages/mcp/**`. Package name `@thallylabs/mcp`, bin
`thally-mcp`, subpath exports unchanged in shape; server name + version
drift fix; tool descriptions ("Thally project", "Thally Track"); scaffold
lib (tarball URL, starter pages, commit msg); track lib:
`AGENT_BRANCH_PREFIX = 'thally/agent-'`, event `thally-document`, env reads
with fallback (`THALLY_GITHUB_TOKEN ?? DOX_GITHUB_TOKEN`, etc.), log tag
`[thally-track]`; README (`claude mcp add thally -- npx -y @thallylabs/mcp`);
tests. Run its vitest suite.

### A3 — `packages/cli` + `packages/agent`
**Owns:** `packages/cli/**`, `packages/agent/**` (legacy `cli/` already
deleted).
`@thallylabs/cli` (bin `thally`, deps on `create-thally` + `@thallylabs/mcp`,
tsup `noExternal: ['@thallylabs/agent']`); router help text (`thally <cmd>`);
commands track/agent/deploy env reads with fallback; emitted workflow
templates (names "Thally docs agent/mention/merge dispatch/track dispatch",
filenames `thally-agent.yml`, `thally-mention.yml`, `thally-track.yml`,
`thally-track-sender-*.yml`, event `thally-document`, trigger `@thally`,
secrets `THALLY_AGENT_TOKEN`/`THALLY_DISPATCH_TOKEN`, placeholder
`__THALLY_PR_NUMBER__`, git author `thally-agent
<thally-agent@users.noreply.github.com>`, loop guard `thally/agent-`);
`@thallylabs/agent` prompt/run/git strings ("You are the Thally
documentation agent", PR body "Drafted by the Thally docs agent");
`isDoxProject` → `isThallyProject`; tests. Run vitest.

### A4 — App runtime: env, auth/state, HTTP/track contracts
**Owns:** `src/lib/**`, `src/app/**` EXCEPT `src/app/globals.css`,
`src/middleware.ts`, `src/data/**`, `scripts/**`, `next.config.ts`.
All `DOX_*` reads → `THALLY_* ?? DOX_*`; cookies → `thally_*`; headers →
`x-thally-*` (middleware + collect route + docs route Vary + chat + llms.txt);
traffic classifier header + enum `x_thally_client`; storage defaults
`.data/thally.db`, `.thally/embeddings`; dev fallback `thally-dev-admin`;
hosted MCP identity `thally-docs` + well-known JSON-LD strings; GitHub App
manifest name `'Thally Track'`; webhook loop guard + dispatch event
`thally-document` (imports from `@thallylabs/mcp/track` — rename import
specifiers); `dispatch-agent.ts`; `tasks.ts` PR-body regexes → "Thally docs
agent"; `site.ts` name/description/links + comments; agent-manifest strings
(`thally check`, "This is a Thally project"); changelog RSS string;
`src/lib` tests (webhook, github-app, site-url). Add redirect
`/guides/dox-track` → `/guides/thally-track` in `next.config.ts`.

### A5 — CSS, components, visual identity
**Owns:** `src/app/globals.css`, `src/styles/**`, `src/components/**`,
`src/mdx/**`, `tailwind.config.ts`, `public/**`.
`--dox-*` → `--thally-*` (defs + every `hsl(var(--…))` consumer incl.
tailwind.config + design-system fallbacks); `.dox-dashboard` →
`.thally-dashboard` (232 selectors + admin-shell classNames + keep
`notes/design-system.md` for A7); all `.dox-*` classes + keyframes + the
JSX/rehype emitters; `git mv` the four `public/brand/dox-*.png` →
`thally-*.png` + update `logo.tsx`, `brand-mark.tsx`, favicon route; admin
UI strings (login `siteName = 'Thally'`, settings/tasks/github-connect/mcp
views: "Thally Track", `thally track add`, `@thally`, `THALLY_ACCESS_PASSWORD`
hints, MCP snippets `thally-docs`); site-banner localStorage key. MUST
verify visually per `verify-frontend-change` skill (dark + light).

### A6 — English content + docs.json
**Owns:** `src/content/**` EXCEPT `src/content/es/**`; `docs.json`.
Copy rewrite of all 35 English MDX files (brand prose, `thally` CLI
commands, `npx create-thally`, `@thallylabs/mcp`, clone URLs
`thallylabs/thally`); `git mv guides/dox-track.mdx guides/thally-track.mdx`
+ update every cross-reference (changelog, introduction, admin-dashboard,
deploying, docs-agent, itself); docs.json: banner text, `ai.label:
"ThallyAI"`, GitHub links, socials, nav entry `guides/thally-track`,
tracking repo → `thallylabs/thally`.

### A7 — Spanish content
**Owns:** `src/content/es/**`. Mirror A6's rewrite across the 27 Spanish
files (keep translations natural; same command/URL/brand substitutions;
`seo-and-visibility.mdx` ThallyAI line).

### A8 — Repo meta
**Owns:** root `package.json` (name `thally`, workspace script paths
`packages/create-thally`, dep `@thallylabs/mcp`), `README.md`,
`.env.example` (THALLY_* only + one legacy-fallback note), `CLAUDE.md`
(toolchain naming), `.github/**` (rename `dox-check.yml` → `thally-check.yml`
incl. job/concurrency names + `npx --yes create-thally@latest`;
`dox-agent.yml` → `thally-agent.yml` with new secrets/author/event;
bug-report template "Thally version:"), `notes/**` (update
product-principles + design-system prose; `git mv notes/dox-v2-*.md` →
`thally-v2-*.md`), `src/phase1plan.md`, `LICENSE` (no change),
`.gitignore` additions if `.thally/`/`.data` patterns need it.

## 3. Execution order

1. **Wave 1 (parallel):** A1–A8 all at once — ownership is disjoint.
   Cross-boundary references converge by convention (brand map): e.g. A4
   renames `@doxlabs/mcp` import specifiers while A2 renames the package.
2. **Wave 2 (single integration agent / main session):**
   - `npm install` (relink workspaces), `npm run packages:build`,
     `npm test`, `npm run build`.
   - Leftover sweep: `grep -ri dox` — everything remaining must be on the
     §1 allowlist (fallback reads, redirect source, historical prose).
   - Fix any cross-seam stragglers (import specifiers, docs.json ↔ slug,
     scaffold exclusion names).
   - `thally check` (via built CLI) + RSC-navigation regression tests +
     visual verification of docs site and admin dashboard (dark/light).

## 4. Outside-the-repo checklist (human actions, post-merge)

- Create npm org `@thallylabs`; publish `create-thally`, `@thallylabs/mcp`,
  `@thallylabs/cli`; `npm deprecate` old `create-dox`/`@doxlabs/*` with a
  pointer message.
- Move/rename GitHub repo to `thallylabs/thally` (create `thallylabs` org,
  transfer; GitHub redirects keep old tarball URLs alive for already
  published create-dox versions).
- Update deployment env (Vercel): add `THALLY_*` names (fallback keeps old
  ones working meanwhile); update GitHub App (create new "Thally Track" app
  or rename existing); rotate scaffolded-repo workflows for existing Track
  users (clean break: they re-run `thally track setup` / `thally agent init`).
- New Thally logo/favicon artwork to replace renamed placeholder PNGs.
- Social handles: register `thallydocs` / `discord.gg/thally` or adjust
  docs.json to real values.
