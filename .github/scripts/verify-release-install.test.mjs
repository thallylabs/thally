/** Regression coverage for clean-install tarball resolution across working directories. */

import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { releaseTarballSpecs } from './verify-release-install.mjs'

test('passes absolute local tarballs to npm when the manifest path is relative', () => {
  const [spec] = releaseTarballSpecs('.release-artifacts/manifest.json', [
    { filename: 'thallylabs-core-0.2.6.tgz' },
  ])

  assert.equal(
    fileURLToPath(spec),
    resolve('.release-artifacts/thallylabs-core-0.2.6.tgz'),
  )
})
