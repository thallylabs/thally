/**
 * Publish prebuilt, attested npm tarballs without running repository code.
 *
 * The OIDC-enabled job executes only this dependency-free script. It validates
 * the artifact manifest, real tarball hashes, and embedded package identities,
 * then publishes those exact bytes. Same-version retries skip only when the
 * registry tarball has the same verified tar payload; gzip encodings can vary
 * across npm/zlib versions even when the package files are byte-for-byte equal.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'

function run(command, argumentsList, inherit = false) {
  return spawnSync(command, argumentsList, {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
  })
}

async function sha512Integrity(path) {
  const bytes = await readFile(path)
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

async function registryMetadata(spec, attempts) {
  let delayMs = 2_000
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = run('npm', ['view', spec, 'dist', '--json'])
    if (result.status === 0) {
      const value = JSON.parse(result.stdout || 'null')
      if (typeof value?.integrity !== 'string' || !value.integrity || typeof value.tarball !== 'string') {
        throw new Error(`npm returned incomplete registry metadata for ${spec}.`)
      }
      return value
    }
    if (!result.stderr.includes('E404')) {
      throw new Error(`Unable to inspect ${spec}: ${result.stderr.trim()}`)
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      delayMs = Math.min(delayMs * 2, 20_000)
    }
  }
  return null
}

const MAX_REGISTRY_TARBALL_BYTES = 50 * 1024 * 1024
const MAX_UNPACKED_TARBALL_BYTES = 100 * 1024 * 1024

/** A compressed-byte mismatch is safe to skip only when npm's real tar payload matches. */
export function tarPayloadSha256(bytes) {
  return createHash('sha256')
    .update(gunzipSync(bytes, { maxOutputLength: MAX_UNPACKED_TARBALL_BYTES }))
    .digest('hex')
}

async function registryTarball(metadata) {
  const url = new URL(metadata.tarball)
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port || url.username || url.password) {
    throw new Error('npm returned an unexpected registry tarball URL.')
  }
  const response = await fetch(url, { redirect: 'error' })
  if (!response.ok || !response.body) throw new Error('Unable to read the published npm tarball.')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > MAX_REGISTRY_TARBALL_BYTES) throw new Error('The published npm tarball is too large.')
    chunks.push(Buffer.from(chunk))
  }
  const bytes = Buffer.concat(chunks)
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  if (integrity !== metadata.integrity) throw new Error('The published npm tarball did not match registry metadata.')
  return bytes
}

/** Validate and publish every tarball in topological order. */
export async function publishReleaseArtifacts(manifestPath, expectedPlanSha256, { verifyOnly = false } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (
    manifest.schemaVersion !== 2 ||
    !manifest.plan ||
    manifest.plan.schemaVersion !== 1 ||
    !Array.isArray(manifest.plan.packages) ||
    !Array.isArray(manifest.plan.dispositions) ||
    !Array.isArray(manifest.packages) ||
    !/^[0-9a-f]{64}$/.test(expectedPlanSha256 ?? '')
  ) {
    throw new Error('The npm release artifact manifest is invalid.')
  }
  const actualPlanSha256 = createHash('sha256')
    .update(`${JSON.stringify(manifest.plan, null, 2)}\n`)
    .digest('hex')
  if (manifest.planSha256 !== expectedPlanSha256 || actualPlanSha256 !== expectedPlanSha256) {
    throw new Error('The npm release plan differs from the trusted planning job.')
  }
  const expected = manifest.plan.packages
  const dispositions = manifest.plan.dispositions.filter((entry) => entry.disposition === 'publish')
  if (
    expected.length === 0 ||
    manifest.packages.length !== expected.length ||
    dispositions.length !== expected.length ||
    new Set(expected.map((entry) => entry.name)).size !== expected.length ||
    expected.some((entry) => !dispositions.some((item) =>
      item.workspace === entry.workspace && item.name === entry.name && item.version === entry.version,
    ))
  ) {
    throw new Error('The npm release artifact set is incomplete.')
  }

  const selectedNames = new Set(expected.map((entry) => entry.name))
  const validatedNames = new Set()
  const verifiedArtifacts = []
  for (const [index, artifact] of manifest.packages.entries()) {
    const { workspace, name: packageName, version } = expected[index]
    if (
      artifact.workspace !== workspace ||
      artifact.name !== packageName ||
      artifact.version !== version ||
      !/^packages\/[^/]+$/.test(workspace) ||
      !/^\d+\.\d+\.\d+$/.test(version) ||
      !/^[a-zA-Z0-9@._+-]+\.tgz$/.test(artifact.filename) ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(artifact.integrity)
    ) {
      throw new Error('The npm release artifact allowlist does not match.')
    }
    const tarball = join(dirname(manifestPath), artifact.filename)
    if ((await sha512Integrity(tarball)) !== artifact.integrity) {
      throw new Error(`${artifact.name} tarball integrity changed after packing.`)
    }
    const embedded = run('tar', ['-xOf', tarball, 'package/package.json'])
    if (embedded.status !== 0) {
      throw new Error(`Unable to read ${artifact.filename}.`)
    }
    const packageManifest = JSON.parse(embedded.stdout)
    if (
      packageManifest.name !== artifact.name ||
      packageManifest.version !== artifact.version ||
      packageManifest.private === true
    ) {
      throw new Error(`${artifact.filename} embeds unexpected package identity.`)
    }
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, range] of Object.entries(packageManifest[field] ?? {})) {
        if (!selectedNames.has(name)) continue
        const dependency = expected.find((entry) => entry.name === name)
        if (range !== dependency.version || !validatedNames.has(name)) {
          throw new Error(`${artifact.name} has an unpublished or out-of-order dependency on ${name}.`)
        }
      }
    }

    const spec = `${artifact.name}@${artifact.version}`
    const existing = await registryMetadata(spec, 6)
    if (existing && existing.integrity !== artifact.integrity) {
      const localPayload = tarPayloadSha256(await readFile(tarball))
      const publishedPayload = tarPayloadSha256(await registryTarball(existing))
      if (localPayload !== publishedPayload) {
        throw new Error(`${spec} exists with different package content.`)
      }
    }
    verifiedArtifacts.push({ artifact, tarball, spec, existing })
    validatedNames.add(artifact.name)
  }

  // Validate every artifact and pre-existing npm version before the first
  // irreversible publish. Runtime failures can still leave a partial release,
  // but a malformed later tarball cannot.
  if (verifyOnly) {
    for (const { spec, existing } of verifiedArtifacts) {
      if (!existing) throw new Error(`${spec} is not published.`)
    }
    console.info(`Verified ${verifiedArtifacts.length} existing npm package(s) without publishing.`)
    return
  }
  for (const { artifact, tarball, spec, existing } of verifiedArtifacts) {
    if (!existing) {
      const published = run(
        'npm',
        ['publish', tarball, '--access', 'public', '--ignore-scripts', '--provenance'],
        true,
      )
      if (published.status !== 0) throw new Error(`Publishing ${spec} failed.`)
    }
    const settled = await registryMetadata(spec, 12)
    if (settled?.integrity !== (existing?.integrity ?? artifact.integrity)) {
      throw new Error(`${spec} did not settle with the expected integrity.`)
    }
    console.info(`${spec} verified at ${artifact.integrity}.`)
  }
}

if (process.argv[1]?.endsWith('publish-release-artifacts.mjs')) {
  await publishReleaseArtifacts(process.argv[2], process.argv[3], {
    verifyOnly: process.argv.includes('--verify-only'),
  })
}
