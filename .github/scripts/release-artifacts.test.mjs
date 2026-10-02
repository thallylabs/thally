/** Focused validation tests for immutable npm release artifact manifests. */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
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

async function writeReleaseFixture() {
  const plan = releasePlan()
  const directory = await mkdtemp(join(tmpdir(), 'thally-publish-fixture-'))
  const packageDirectory = join(directory, 'package')
  await mkdir(packageDirectory)
  await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({
    name: '@thallylabs/cli',
    version: '1.2.3',
  }))
  const filename = 'cli-1.2.3.tgz'
  const packed = spawnSync('tar', ['-czf', filename, 'package'], { cwd: directory })
  assert.equal(packed.status, 0)
  const integrity = `sha512-${createHash('sha512').update(await readFile(join(directory, filename))).digest('base64')}`
  const manifestPath = join(directory, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 2,
    plan,
    planSha256: planSha256(plan),
    packages: [{ ...plan.packages[0], filename, integrity }],
  }))
  return { manifestPath, planHash: planSha256(plan), integrity }
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

test('publishes after one absent preflight lookup, then verifies registry settlement', async () => {
  const { manifestPath, planHash, integrity } = await writeReleaseFixture()
  const metadata = {
    integrity,
    tarball: 'https://registry.npmjs.org/@thallylabs/cli/-/cli-1.2.3.tgz',
  }
  let views = 0
  let publishes = 0
  await publishReleaseArtifacts(manifestPath, planHash, {
    runCommand: (command, args) => {
      if (command === 'tar') return spawnSync(command, args, { encoding: 'utf8' })
      if (command === 'npm' && args[0] === 'view') {
        views += 1
        return views === 1
          ? { status: 1, stderr: 'npm error code E404' }
          : { status: 0, stdout: JSON.stringify(metadata) }
      }
      if (command === 'npm' && args[0] === 'publish') {
        publishes += 1
        return { status: 0 }
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
    },
  })
  assert.equal(views, 2)
  assert.equal(publishes, 1)
})

test('an already-published identical version remains an idempotent retry', async () => {
  const { manifestPath, planHash, integrity } = await writeReleaseFixture()
  const metadata = {
    integrity,
    tarball: 'https://registry.npmjs.org/@thallylabs/cli/-/cli-1.2.3.tgz',
  }
  let views = 0
  await publishReleaseArtifacts(manifestPath, planHash, {
    runCommand: (command, args) => {
      if (command === 'tar') return spawnSync(command, args, { encoding: 'utf8' })
      if (command === 'npm' && args[0] === 'view') {
        views += 1
        return { status: 0, stdout: JSON.stringify(metadata) }
      }
      throw new Error('An existing version must never be published again')
    },
  })
  assert.equal(views, 2)
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
