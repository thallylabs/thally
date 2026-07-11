import { createRequire } from 'node:module'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'
import { tools } from './lib/tools.js'

type ToolResult = { content: Array<{ type: 'text'; text: string }> }

// Both src/ and dist/ sit one level below the package root, so this resolves
// from either the bundled output or the raw source (tests).
const pkg = createRequire(import.meta.url)('../package.json') as {
  name: string
  version: string
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: pkg.name,
    version: pkg.version,
  })

  // Cast to a concrete signature: the SDK's `tool` overload infers arg types
  // from the zod shape, which recurses infinitely on our type-erased registry.
  const register = server.tool.bind(server) as (
    name: string,
    description: string,
    shape: z.ZodRawShape,
    cb: (input: Record<string, unknown>) => Promise<ToolResult>,
  ) => void

  // Register every tool from the shared registry. The stdio server, the remote
  // MCP route (A6), and the docs agent (A1) all draw from the same source.
  for (const tool of tools) {
    register(tool.name, tool.description, tool.schema.shape, async (input) => {
      try {
        const text = await tool.handler(input)
        return { content: [{ type: 'text', text }] }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return server
}
