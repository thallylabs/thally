/**
 * Publish prebuilt, attested npm tarballs without running repository code.
 *
 * The OIDC-enabled job executes only this dependency-free script. It validates
 * the artifact manifest, real tarball hashes, and embedded package identities,
 * then publishes those exact bytes. Same-version retries remain safe: matching
 * registry integrity skips, while any mismatch fails closed.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const prerequisitePackages = [
  ['packages/core', '@thallylabs/core'],
  ['packages/migrate', '@thallylabs/migrate'],
]

const scaffoldPackages = [
  ['packages/create-thally-docs', 'create-thally-docs'],
  ['packages/mcp', '@thallylabs/mcp'],
  ['packages/cli', '@thallylabs/cli'],
]

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

async function registryIntegrity(spec, attempts) {
  let delayMs = 2_000
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = run('npm', ['view', spec, 'dist.integrity', '--json'])
    if (result.status === 0) {
      const value = JSON.parse(result.stdout || 'null')
      return typeof value === 'string' && value ? value : null
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

/** Validate and publish every tarball in topological order. */
export async function publishReleaseArtifacts(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.packages)) {
    throw new Error('The npm release artifact manifest is invalid.')
  }
  const expected = manifest.packages.length === 2
    ? prerequisitePackages
    : manifest.packages.length === 3
      ? scaffoldPackages
      : null
  if (!expected) {
    throw new Error('The npm release artifact set is incomplete.')
  }

  for (const [index, artifact] of manifest.packages.entries()) {
    const [workspace, packageName] = expected[index]
    if (
      artifact.workspace !== workspace ||
      artifact.name !== packageName ||
      !/^\d+\.\d+\.\d+$/.test(artifact.version) ||
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
      packageManifest.version !== artifact.version
    ) {
      throw new Error(`${artifact.filename} embeds unexpected package identity.`)
    }

    const spec = `${artifact.name}@${artifact.version}`
    const existing = await registryIntegrity(spec, 6)
    if (existing && existing !== artifact.integrity) {
      throw new Error(`${spec} exists with different package integrity.`)
    }
    if (!existing) {
      const published = run(
        'npm',
        ['publish', tarball, '--access', 'public', '--ignore-scripts', '--provenance'],
        true,
      )
      if (published.status !== 0) throw new Error(`Publishing ${spec} failed.`)
    }
    const settled = await registryIntegrity(spec, 12)
    if (settled !== artifact.integrity) {
      throw new Error(`${spec} did not settle with the expected integrity.`)
    }
    console.info(`${spec} verified at ${artifact.integrity}.`)
  }
}

if (process.argv[1]?.endsWith('publish-release-artifacts.mjs')) {
  await publishReleaseArtifacts(process.argv[2])
}
