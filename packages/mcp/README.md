# @thallylabs/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI
tools — Claude Code, Claude Desktop, Cursor, Windsurf — manage
[Thally](https://github.com/thallylabs/thally) knowledge surfaces through
natural language. Tools can create, read, update, search, and migrate
documentation, then trace a product-repository change into reviewable docs
work.

## Setup

Add it to your MCP client. For Claude Code:

```bash
claude mcp add thally -- npx -y @thallylabs/mcp
```

Or in a `mcp.json` / client config:

```json
{
  "mcpServers": {
    "thally": {
      "command": "npx",
      "args": ["-y", "@thallylabs/mcp"]
    }
  }
}
```

## Tools

15 tools, including:

- **Authoring** — `create_project`, `add_page`, `update_page`, `read_page`, `list_pages`, `add_tab`
- **Context & search** — `get_context`, `search_docs`, `semantic_search` (against a deployed site)
- **Quality** — `lint_project`, `agent_readiness` (the Agent Readiness Score of a deployed site)
- **Migration** — `migrate_docs`, `import_docs`, `translate_docs`
- **Product changes** — `sync_from_repo`

`search_docs`, `read_page`, and `get_context` work against a local project on
disk; `semantic_search` and `agent_readiness` run against any **deployed** Thally
site over HTTP.

`migrate_docs` always scaffolds a fresh canonical Thally template before it
imports content. To preserve an existing Thally runtime and import content in
place, the caller must explicitly choose `import_docs`.

## License

MIT
