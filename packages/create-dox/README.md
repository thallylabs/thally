# create-dox

Scaffold a new [Dox](https://github.com/kenny-io/Dox) documentation project — an
agent-native docs site that serves every page to humans as polished HTML and to
AI agents as structured JSON, JSON-LD, and Markdown from the same URL.

## Quick start

```bash
npx create-dox my-docs
cd my-docs
npm run dev
```

Then open [http://localhost:3040](http://localhost:3040). A freshly scaffolded
site is agent-ready out of the box and scores 100/A on the built-in
[Agent Readiness Score](https://github.com/kenny-io/Dox).

Run non-interactively with smart defaults:

```bash
npx create-dox my-docs --yes
```

## What you get

- **MDX content** in `src/content/`, navigation in `docs.json`
- **Agent endpoints** — `/llms.txt`, `/ai.txt`, `/api/docs-index`, `/api/agent-readiness`
- **Hybrid search**, **retrieval-grounded AI chat**, and an **admin analytics** dashboard
- **Starter content** with keywords and structured pages, ready to edit

## Other commands

| Command | What it does |
| --- | --- |
| `create-dox <dir>` | Scaffold a new project |
| `create-dox migrate <github-url> [dir]` | Import docs from a GitHub repo (Mintlify, Docusaurus, GitBook, Nextra, …) |
| `create-dox check [dir] [--fix]` | Lint content for orphan pages and missing frontmatter |
| `create-dox translate --locale <code>` | Translate content into another locale |

Prefer a single binary? Install [`@doxlabs/cli`](https://www.npmjs.com/package/@doxlabs/cli)
and use `dox init`, which delegates here.

## License

MIT
