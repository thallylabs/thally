# `dox` — the unified Dox CLI

One tool, one mental model. You author **content + config**; the framework
(Next.js) is a hidden runtime you never touch.

## The model

A Dox project is just three things you own:

- `src/content/` — your MDX pages
- `docs.json` — navigation, theme, and config
- `snippets/` — reusable MDX

Everything under `src/app/` is framework plumbing managed by Dox. You should
never need to edit it. The `dox` commands wrap the framework so the runtime
stays invisible.

## Commands

| Command | What it does |
| --- | --- |
| `dox init [dir]` | Scaffold a new Dox project |
| `dox dev` | Run the docs site locally (agent endpoints live) |
| `dox build` | Build the production site |
| `dox start` | Serve the built production site |
| `dox deploy [--prod]` | Build and deploy to a live URL, print agent endpoints |
| `dox check [--agents] [--fix]` | Lint content + Agent Readiness Score |
| `dox new <page-id> [--title]` | Create a page and register it in `docs.json` |
| `dox migrate <github-url> [dir]` | Migrate docs from a GitHub repo |
| `dox translate --locale <code>` | Translate content into a locale |
| `dox mcp` | Start the Model Context Protocol server (stdio) |

Run `dox` with no arguments for the full help.

## How it works

- **Framework commands** (`dev`, `build`, `start`, `deploy`) prefer the
  project's npm scripts and fall back to invoking the framework directly — so
  the framework is an implementation detail, not part of your surface.
- **Authoring commands** (`init`, `migrate`, `translate`) delegate to
  `create-dox`; `mcp` starts `@doxlabs/mcp`. All capabilities are reachable through
  the single `dox` binary.
- **`check --agents`** runs content lint plus the Agent Readiness Score, with a
  CI-friendly non-zero exit code when the score is below the threshold.
