import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

// Node version guard
const [major] = process.versions.node.split('.').map(Number)
if (major < 18) {
  console.error('Error: @thallylabs/mcp requires Node.js >= 18')
  process.exit(1)
}

async function main(): Promise<void> {
  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err: Error) => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
