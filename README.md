# Thally

Build and publish Git-owned docs for people and AI tools with Thally's
MIT-licensed documentation engine and public toolchain. One MDX source can
serve HTML, Markdown, structured JSON, JSON-LD, `llms.txt`, RSS, and a live MCP
endpoint. Self-host it or connect the site to Thally Cloud.

**Documentation:** [docs.thally.io](https://docs.thally.io)

## Start a docs site

```bash
npx create-thally-docs my-docs
cd my-docs
npm run dev
```

The site starts at [http://localhost:3040](http://localhost:3040). See the
[quickstart](https://docs.thally.io/quickstart) for the full walkthrough.

## Connect an AI tool over MCP

Every deployed Thally site is a read-only MCP server at `/api/mcp`, so agents
can search and read your docs as structured content:

```bash
claude mcp add --transport http thally-docs https://docs.thally.io/api/mcp
```

Swap in your own site's URL to connect to your docs. See
[Remote MCP](https://docs.thally.io/guides/remote-mcp).

## Keep product knowledge aligned

**The product knowledge layer for software teams.**

Your product changed. Did your docs, website, and help center? Connect the
repositories that define your product and the places customers learn about it.
When a pull request merges, Thally Track gathers the evidence, traces the
impact, and opens evidence-backed pull requests for your team to review. A
no-change result is valid. Nothing publishes without human approval.

## Features

- **MDX content** with React components, configured from a single `docs.json`
- **Auto-generated API reference** from an OpenAPI spec, with a "Try It" console
- **Hybrid search**: instant command palette plus full-text and vector search
- **AI chat** with cited answers when the site is linked to Thally Cloud
- **Agent endpoints**: `llms.txt`, per-page Markdown and JSON, and an Agent Readiness Score
- **Remote MCP server and WebMCP** on every deployed site
- **Docs agent** that drafts updates as reviewed pull requests, never merging on its own
- **Drift checks** that flag pages gone stale against the code they document
- **Team sign-in and roles** from a roster committed to `docs.json`
- **Dark mode, table of contents, and responsive layout** out of the box

## Learn more

- [Configuring navigation](https://docs.thally.io/guides/configuring-navigation)
- [API reference setup](https://docs.thally.io/guides/api-reference-setup)
- [Deploying](https://docs.thally.io/guides/deploying)
- [Environment variables](https://docs.thally.io/guides/environment-variables)
- [CLI overview](https://docs.thally.io/guides/cli-overview)

## Contributing

Pull requests target `main`. Before opening one, run `npm test`,
`npm run lint`, and `npm run build`. Runtime changes belong in this repository;
`thallylabs/starter` is generated from it, so please don't patch the starter
directly. Known upstream build warnings are tracked in
[`BUILD-WARNINGS.md`](BUILD-WARNINGS.md).

## License

MIT
