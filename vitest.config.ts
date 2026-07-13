import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    // Next replaces this marker at build time; Vitest needs a harmless module
    // so server-only units can be exercised in its Node environment.
    alias: {
      'server-only': new URL('./src/test/server-only.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
