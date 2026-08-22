/** Focused argument validation for the one-command release entrypoint. */

import assert from 'node:assert/strict'
import test from 'node:test'

import { startFullRelease } from './start-full-release.mjs'

test('rejects mutable or historical source selection arguments', () => {
  assert.throws(() => startFullRelease(['--runtime-sha', 'a'.repeat(40)]), /Usage/)
})
