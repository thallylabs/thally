import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  // Resolved at runtime from the dependency tree, not bundled.
  external: ['@anthropic-ai/sdk', '@thallylabs/mcp', 'playwright', 'playwright-core'],
  clean: true,
  dts: true,
})
