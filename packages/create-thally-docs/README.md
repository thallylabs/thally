# create-thally-docs

Scaffold a new [Thally](https://github.com/thallylabs/thally) documentation project — an
agent-native docs site that serves every page to humans as polished HTML and to
AI agents as structured JSON, JSON-LD, and Markdown from the same URL.

## Quick start

```bash
npx create-thally-docs my-docs
cd my-docs
npm run dev
```

Then open [http://localhost:3040](http://localhost:3040). A freshly scaffolded
site is agent-ready out of the box and scores 100/A on the built-in
[Agent Readiness Score](https://github.com/thallylabs/thally).

Run non-interactively with smart defaults:

```bash
npx create-thally-docs my-docs --yes
```

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

Prefer a single binary? Install [`@thallylabs/cli`](https://www.npmjs.com/package/@thallylabs/cli)
and use `thally init`, which delegates here.

## License

MIT
