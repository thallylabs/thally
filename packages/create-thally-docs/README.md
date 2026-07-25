# create-thally-docs

Scaffold the first customer-facing knowledge surface in a
[Thally](https://github.com/thallylabs/thally) product-knowledge pipeline. The
result is an open documentation site that serves every page to humans as
polished HTML and to agents as structured JSON, JSON-LD, and Markdown from the
same URL.

## Quick start

```bash
npx create-thally-docs my-docs
cd my-docs
npm install
npm run dev
```

The dev server starts at [http://localhost:3040](http://localhost:3040) and
automatically uses the next available port when needed. A freshly scaffolded
site is agent-ready out of the box and scores 100/A on the built-in
[Agent Readiness Score](https://github.com/thallylabs/thally).

Run non-interactively with smart defaults:

```bash
npx create-thally-docs my-docs --yes
```

Dependency installation is deliberately opt-in so the scaffold finishes in
seconds. Pass `--install` to run it immediately, or `--no-install` to skip the
interactive question explicitly.

## What you get

- **MDX content** in `src/content/`, navigation in `docs.json`
- **Agent endpoints** — `/llms.txt`, `/ai.txt`, `/api/docs-index`, `/api/agent-readiness`
- **Hybrid search**, **retrieval-grounded AI chat**, and an **admin analytics** dashboard
- **Starter content** with keywords and structured pages, ready to edit

## Other commands

| Command | What it does |
| --- | --- |
| `create-thally-docs <dir>` | Scaffold a new project |
| `create-thally-docs migrate <github-or-docs-url> [dir]` | Import a docs repository or public docs site through the shared migration engine |
| `create-thally-docs check [dir] [--fix]` | Lint content for orphan pages and missing frontmatter |
| `create-thally-docs translate --locale <code>` | Translate content into another locale |

Interactive migrations ask whether the source is Mintlify, Docusaurus, or
another auto-detected platform. For scripts and CI, pass
`--platform mintlify`, `--platform docusaurus`, or `--platform auto`; `--yes`
keeps backward-compatible auto-detection when no platform flag is supplied.

Prefer a single binary? Install [`@thallylabs/cli`](https://www.npmjs.com/package/@thallylabs/cli)
and use `thally init`, which delegates here.

## License

MIT
