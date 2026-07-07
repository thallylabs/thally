import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  banner: {
    js: '#!/usr/bin/env node',
  },
  // Bundle @doxlabs/agent INTO the CLI (it's the engine behind `dox agent`, not a
  // standalone package). Its remaining externals resolve from the CLI's own deps.
  noExternal: ['@doxlabs/agent'],
  external: ['playwright', 'playwright-core'],
  clean: true,
  dts: false,
})
