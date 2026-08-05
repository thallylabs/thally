import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/scaffold.ts',
    'src/customize.ts',
    'src/release.ts',
    'src/starter-sync.ts',
    'src/starter-update.ts',
    'src/migrate/index.ts',
  ],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ['playwright', 'playwright-core'],
  clean: true,
  dts: true,
})
