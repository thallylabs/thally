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
  // receiver (`@thallylabs/mcp/track`). Dependency-free, typed.
  {
    entry: { track: 'src/lib/track.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node18',
    dts: true,
  },
])
