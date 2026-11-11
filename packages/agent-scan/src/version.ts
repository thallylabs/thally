/**
 * The scanner version, read from the package manifest so source (tests) and
 * the built bundle report the same value. Both `src/` and `dist/` sit one
 * level below the package root.
 */

import { readFileSync } from 'node:fs'

/** The `@thallylabs/agent-scan` package version. */
export const scannerVersion: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version
