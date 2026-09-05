# `thally` CLI

Use one CLI to scaffold, write, check, migrate, and publish Thally docs. You
author **content + config** while Thally keeps the Next.js runtime out of your
way. The same toolchain can trace a product change into documentation work your
team reviews before it publishes.

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

| Command                                     | What it does                                                   |
| ------------------------------------------- | -------------------------------------------------------------- |
| `thally init [dir]`                         | Scaffold a new Thally project                                  |
| `thally dev`                                | Run the docs site locally (agent endpoints live)               |
| `thally build`                              | Build the production site                                      |
| `thally start`                              | Serve the built production site                                |
| `thally deploy [--prod]`                    | Build and deploy to a live URL, print agent endpoints          |
| `thally check [--agents] [--fix]`           | Lint content + Agent Readiness Score                           |
| `thally new <page-id> [--title]`            | Create a page and register it in `docs.json`                   |
| `thally migrate <github-or-docs-url> [dir]` | Migrate a docs repository or public docs site                  |
| `thally translate --locale <code>`          | Translate content into a locale                                |
| `thally starter update [--apply]`           | Plan or explicitly apply an immutable three-way runtime update |
| `thally mcp`                                | Start the Model Context Protocol server (stdio)                |

`thally migrate` asks which platform currently hosts the docs and dispatches to
the Mintlify or Docusaurus adapter. Non-interactive callers can pass
`--platform mintlify`, `--platform docusaurus`, or `--platform auto`.

Run `thally` with no arguments for the full help.

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
