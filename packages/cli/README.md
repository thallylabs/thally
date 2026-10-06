# `thally` CLI

Product knowledge, kept in step with your code.

Create a docs site, write and publish content, and prepare updates from product
changes for your team to review.

```bash
npx @thallylabs/cli init my-docs --yes
cd my-docs
npm install
npx thally dev
```

## Terminal output

Interactive terminals show the THALLY wordmark, task headings, and live progress.
Running `thally` opens a short welcome; `thally --help` shows the command reference.
The wordmark adapts to narrow terminals. Output automatically
uses plain text in CI, when output is not a TTY, with `TERM=dumb`, or when
`NO_COLOR` is set. `thally --version` prints only the installed version; MCP
stdio and machine-readable check output keep their protocol format.

Setup and migration end with an olive next-action panel and one copyable
preview command, including `npm install` when needed.

Scaffolding and migration keep subprocess logs quiet in interactive terminals.
Pass `--verbose` to show installation and build logs as they happen:

```bash
thally init my-docs --yes --install --verbose
thally migrate https://github.com/your-org/your-docs --platform auto --verbose
```

Long-running steps show their current activity and elapsed time. Plain logs report an elapsed heartbeat every 15 seconds. Conversion, rendering, and content validation run off the terminal thread so progress keeps updating during larger imports.

Failures always show diagnostics, including without `--verbose`; quiet output retains the last 64 KiB. Non-interactive
runs retain subprocess output for scripts and CI.

## The model

You own the portable content and configuration surfaces:

- `src/content/` — MDX pages
- `docs.json` — navigation, theme, and product configuration
- `src/data/site.ts` — site identity, links, and brand defaults
- `src/mdx/custom-components.tsx` — customer MDX components
- `snippets/` — reusable MDX
- `public/` and `openapi.yaml` — public assets and API specifications

Framework-owned paths are recorded in `starter-release.json` and managed by
Thally. `src/app/` is framework plumbing, but it is not the complete ownership
contract. The `thally` commands keep the runtime invisible while preserving
customer-owned paths during upgrades.

## Commands

| Command | What it does |
| --- | --- |
| `thally init [dir] [--verbose]` | Create a new documentation site |
| `thally new <page-id> [--title "..."]` | Create a page and add it to navigation |
| `thally migrate <github-or-docs-url> [dir] [--verbose]` | Import an existing documentation site |
| `thally translate --locale <code>` | Translate content into a locale |
| `thally dev` | Preview your site locally |
| `thally build` | Build the production site |
| `thally start` | Serve the built production site |
| `thally deploy [--prod] [--cloudflare]` | Build and publish through Vercel or Cloudflare |
| `thally check [--agents] [--fix]` | Check content and agent readiness |
| `thally starter update [--apply]` | Review or apply a site runtime update |
| `thally agent "<instruction>"` | Draft updates from product changes for review |
| `thally track <add\|list\|test\|setup>` | Turn merged product PRs into docs PRs |
| `thally mcp` | Start the Model Context Protocol server (stdio) |

`thally migrate` writes a `migration-report.json` with content and production
build check statuses. Failed checks return a nonzero status while retaining imported
files for review. `--skip-validation` explicitly performs an unverified import.
Fresh migrations install dependencies and validate the production build
automatically, without an extra confirmation or execution flag. Migration runs
project code locally, including imported MDX and components, so use sources you
own or trust. `--skip-validation` also skips dependency installation.

`thally migrate` asks which platform currently hosts the docs and dispatches to
the Mintlify or Docusaurus adapter. Non-interactive callers can pass
`--platform mintlify`, `--platform docusaurus`, or `--platform auto`.

Run `thally --help` for the full command reference.

`thally starter update` is a dry run by default. It compares the previously
recorded scaffold, the promoted target scaffold, and the current project. It
automatically updates unchanged framework-owned files, preserves user-owned
paths, and reports manual-review conflicts before `--apply` writes anything.

## How it works

- **Framework commands** (`dev`, `build`, `start`, `deploy`) prefer the
  project's npm scripts and fall back to invoking the framework directly — so
  the framework is an implementation detail, not part of your surface.
- **Authoring commands** (`init`, `migrate`, `translate`) delegate to
  `create-thally-docs`; `starter update` uses the same immutable scaffold
  catalog and ownership-aware updater; `mcp` starts `@thallylabs/mcp`. All
  capabilities are reachable through the single `thally` binary.
- **`check --agents`** runs content lint plus the Agent Readiness Score, with a
  CI-friendly non-zero exit code when the score is below the threshold.
