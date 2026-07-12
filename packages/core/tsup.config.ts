import { defineConfig } from 'tsup'

/**
 * Two typed ESM entry points:
 *  - `index`  — the server-oriented engine (content, search, embeddings).
 *  - `theme`  — pure brand-token helpers, client-safe (no Node/MDX/search deps).
 *
 * Heavy runtime deps (MDX/remark stack, Orama) are left external so consumers
 * resolve the workspace-hoisted copies rather than bundling them in.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    theme: 'src/theme/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  dts: true,
  clean: true,
  sourcemap: true,
})
