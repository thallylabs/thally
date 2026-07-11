# `thally` — the unified Thally CLI

One tool, one mental model. You author **content + config**; the framework
(Next.js) is a hidden runtime you never touch.

## The model

A Thally project is just three things you own:

- `src/content/` — your MDX pages
- `docs.json` — navigation, theme, and config
- `snippets/` — reusable MDX

Everything under `src/app/` is framework plumbing managed by Thally. You should
never need to edit it. The `thally` commands wrap the framework so the runtime
stays invisible.

## Commands

| Command | What it does |
| --- | --- |
| `thally init [dir]` | Scaffold a new Thally project |
| `thally dev` | Run the docs site locally (agent endpoints live) |
| `thally build` | Build the production site |
| `thally start` | Serve the built production site |
| `thally deploy [--prod]` | Build and deploy to a live URL, print agent endpoints |
| `thally check [--agents] [--fix]` | Lint content + Agent Readiness Score |
| `thally new <page-id> [--title]` | Create a page and register it in `docs.json` |
| `thally migrate <github-url> [dir]` | Migrate docs from a GitHub repo |
| `thally translate --locale <code>` | Translate content into a locale |
| `thally mcp` | Start the Model Context Protocol server (stdio) |

Run `thally` with no arguments for the full help.

## How it works

- **Framework commands** (`dev`, `build`, `start`, `deploy`) prefer the
  project's npm scripts and fall back to invoking the framework directly — so
  the framework is an implementation detail, not part of your surface.
- **Authoring commands** (`init`, `migrate`, `translate`) delegate to
  `create-thally-docs`; `mcp` starts `@thallylabs/mcp`. All capabilities are reachable through
  the single `thally` binary.
- **`check --agents`** runs content lint plus the Agent Readiness Score, with a
  CI-friendly non-zero exit code when the score is below the threshold.
