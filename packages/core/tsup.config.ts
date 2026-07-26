import { defineConfig } from 'tsup'

/**
 * Typed ESM entry points:
 *  - `index`   — the server-oriented engine barrel (content, search, embeddings).
 *  - `content` — the content pipeline alone (parse, document, markdown
 *                projection), so consumers that only transform content don't
 *                drag the search/embeddings graph into their bundles.
 *  - `theme`   — pure brand-token helpers, client-safe (no Node/MDX/search deps).
 *
 * Entries share code via tsup's ESM chunk splitting, so `content` and the
 * barrel resolve to the same modules rather than duplicated copies.
 *
 * Heavy runtime deps (MDX/remark stack, Orama) are left external so consumers
 * resolve the workspace-hoisted copies rather than bundling them in.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    content: 'src/content/index.ts',
    theme: 'src/theme/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  dts: true,
  clean: true,
  sourcemap: true,
})
