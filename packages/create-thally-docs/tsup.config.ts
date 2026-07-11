import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/scaffold.ts', 'src/migrate/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ['playwright', 'playwright-core'],
  clean: true,
  dts: false,
})
