/** Focused validation tests for immutable npm release artifact manifests. */

import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { publishReleaseArtifacts } from './publish-release-artifacts.mjs'

test('rejects package sets outside the topological allowlist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'thally-release-artifacts-'))
  const manifestPath = join(directory, 'manifest.json')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      packages: [
        {
          workspace: 'packages/cli',
          name: '@thallylabs/cli',
          version: '1.2.3',
          filename: 'cli.tgz',
          integrity: `sha512-${'a'.repeat(86)}==`,
        },
        {
          workspace: 'packages/migrate',
          name: '@thallylabs/migrate',
          version: '1.2.3',
          filename: 'migrate.tgz',
          integrity: `sha512-${'a'.repeat(86)}==`,
        },
      ],
    }),
  )
  await assert.rejects(
    publishReleaseArtifacts(manifestPath),
    /allowlist does not match/,
  )
})

test('rejects partial scaffold package chains', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'thally-release-artifacts-'))
  const manifestPath = join(directory, 'manifest.json')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      packages: Array.from({ length: 4 }, () => ({})),
    }),
  )
  await assert.rejects(
    publishReleaseArtifacts(manifestPath),
    /artifact set is incomplete/,
  )
})
