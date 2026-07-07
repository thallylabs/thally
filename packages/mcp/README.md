# @doxlabs/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI
tools — Claude Code, Claude Desktop, Cursor, Windsurf — create, read, update,
search, and migrate [Dox](https://github.com/kenny-io/Dox) documentation projects
through natural language.

## Setup

Add it to your MCP client. For Claude Code:

```bash
claude mcp add dox -- npx -y @doxlabs/mcp
```

Or in a `mcp.json` / client config:

```json
{
  "mcpServers": {
    "dox": {
      "command": "npx",
      "args": ["-y", "@doxlabs/mcp"]
    }
  }
}
```

## Tools

13 tools, including:

- **Authoring** — `create_project`, `add_page`, `update_page`, `read_page`, `list_pages`, `add_tab`
- **Context & search** — `get_context`, `search_docs`, `semantic_search` (against a deployed site)
- **Quality** — `lint_project`, `agent_readiness` (the Agent Readiness Score of a deployed site)
- **Migration** — `migrate_docs`, `translate_docs`

`search_docs`, `read_page`, and `get_context` work against a local project on
disk; `semantic_search` and `agent_readiness` run against any **deployed** Dox
site over HTTP.

## License

MIT
