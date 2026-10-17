import { defineConfig } from 'tsup'

export default defineConfig([
  // CLI/stdio server entry — shebang, no types needed.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
    external: ['playwright', 'playwright-core'],
    clean: true,
    dts: false,
  },
  // Library entry — the shared tool registry consumed by @thallylabs/agent. Typed,
  // no shebang.
  {
    entry: { tools: 'src/lib/tools.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node18',
    external: ['playwright', 'playwright-core'],
    dts: true,
  },
  // Track distiller — shared by the agent, the CLI, and the Next.js webhook
  // receiver (`@thallylabs/mcp/track`). Typed and dependency-free at runtime:
  // the pure repository/tracking helpers from @thallylabs/core are inlined.
  {
    entry: { track: 'src/lib/track.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node18',
    noExternal: [/^@thallylabs\/core\/(repository|tracking)$/],
    dts: true,
  },
  // Project creation is a library surface as well as an MCP tool. Keeping a
  // typed entry makes parity smoke tests exercise the published package path.
  {
    entry: { 'create-project': 'src/tools/create-project.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node18',
    external: ['playwright', 'playwright-core'],
    dts: true,
  },
])
