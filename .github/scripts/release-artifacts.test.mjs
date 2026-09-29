/** Focused validation tests for immutable npm release artifact manifests. */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'

import {
  publishReleaseArtifacts,
  registryMetadata,
  REGISTRY_SETTLE_ATTEMPTS,
  tarPayloadSha256,
} from './publish-release-artifacts.mjs'

function releasePlan() {
  return {
    schemaVersion: 1,
    dispositions: [{ workspace: 'packages/cli', name: '@thallylabs/cli', version: '1.2.3', disposition: 'publish' }],
    packages: [{ workspace: 'packages/cli', name: '@thallylabs/cli', version: '1.2.3' }],
  }
}

function planSha256(plan) {
  return createHash('sha256').update(`${JSON.stringify(plan, null, 2)}\n`).digest('hex')
}

async function writeManifest(manifest) {
  const directory = await mkdtemp(join(tmpdir(), 'thally-release-artifacts-'))
  const path = join(directory, 'manifest.json')
  await writeFile(path, JSON.stringify(manifest))
  return path
}

test('rejects a release plan that differs from the trusted planning job', async () => {
  const plan = releasePlan()
  const path = await writeManifest({ schemaVersion: 2, plan, planSha256: planSha256(plan), packages: [] })
  await assert.rejects(publishReleaseArtifacts(path, 'a'.repeat(64)), /differs from the trusted planning job/)
})

test('compares tar payloads independent of gzip compression level', () => {
  const payload = Buffer.from('identical npm tar payload'.repeat(100))
  const fast = gzipSync(payload, { level: 1 })
  const compact = gzipSync(payload, { level: 9 })
  assert.notDeepEqual(fast, compact)
  assert.equal(tarPayloadSha256(fast), tarPayloadSha256(compact))
})

test('waits beyond twelve absent registry reads after an acknowledged publish', async () => {
  let reads = 0
  const delays = []
  const metadata = {
    integrity: `sha512-${'a'.repeat(86)}==`,
    tarball: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz',
  }
  const settled = await registryMetadata('example@1.0.0', REGISTRY_SETTLE_ATTEMPTS, {
    runCommand: () => {
      reads += 1
      return reads === 13
        ? { status: 0, stdout: JSON.stringify(metadata) }
        : { status: 1, stderr: 'npm error code E404' }
    },
    sleep: async (delayMs) => { delays.push(delayMs) },
  })

  assert.equal(REGISTRY_SETTLE_ATTEMPTS, 18)
  assert.equal(reads, 13)
  assert.equal(delays.length, 12)
  assert.equal(Math.max(...delays), 20_000)
  assert.deepEqual(settled, metadata)
})

test('does not retry unrelated registry failures', async () => {
  let reads = 0
  await assert.rejects(
    registryMetadata('example@1.0.0', REGISTRY_SETTLE_ATTEMPTS, {
      runCommand: () => {
        reads += 1
        return { status: 1, stderr: 'npm error code E401' }
      },
      sleep: async () => { throw new Error('unexpected retry') },
    }),
    /Unable to inspect example@1\.0\.0: npm error code E401/,
  )
  assert.equal(reads, 1)
})

test('rejects an omitted planned package before any registry call', async () => {
  const plan = releasePlan()
  const path = await writeManifest({ schemaVersion: 2, plan, planSha256: planSha256(plan), packages: [] })
  await assert.rejects(publishReleaseArtifacts(path, planSha256(plan)), /artifact set is incomplete/)
})

test('rejects a package that disagrees with its graph-derived disposition', async () => {
  const plan = releasePlan()
  const path = await writeManifest({
    schemaVersion: 2,
    plan,
    planSha256: planSha256(plan),
    packages: [{ workspace: 'packages/migrate', name: '@thallylabs/migrate', version: '1.2.3', filename: 'migrate.tgz', integrity: `sha512-${'a'.repeat(86)}==` }],
  })
  await assert.rejects(publishReleaseArtifacts(path, planSha256(plan)), /allowlist does not match/)
})
