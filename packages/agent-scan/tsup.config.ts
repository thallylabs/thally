import { defineConfig } from 'tsup'

export default defineConfig({
  // The CLI is a separate entry so the library import never pulls in argv
  // parsing or process exit handling.
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  splitting: false,
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: { entry: { index: 'src/index.ts' } },
  clean: true,
  sourcemap: true,
})
