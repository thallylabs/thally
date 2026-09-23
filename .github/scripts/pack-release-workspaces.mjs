/**
 * Build the immutable npm artifact set before any job receives OIDC authority.
 *
 * `npm test` has already built every workspace. This script packs each selected
 * package exactly once with lifecycle scripts disabled, verifies npm's reported
 * SRI against the real tarball bytes, and writes the allowlisted manifest the
 * minimal trusted-publishing job consumes.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'

function runNpm(argumentsList) {
  return spawnSync('npm', argumentsList, { encoding: 'utf8' })
}

async function sha512Integrity(path) {
  const bytes = await readFile(path)
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

/** Pack and describe the exact package files selected for this release. */
export async function packReleaseWorkspaces({ outputDirectory, planPath }) {
  if (!outputDirectory || !planPath) throw new Error('An artifact output directory and plan are required.')
  await mkdir(outputDirectory, { recursive: true })
  const planBytes = await readFile(planPath)
  const plan = JSON.parse(planBytes.toString('utf8'))
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.packages) || plan.packages.length === 0) {
    throw new Error('The npm release plan has no publishable packages.')
  }
  if (plan.packages.some((entry) =>
    !/^packages\/[a-z0-9-]+$/.test(entry.workspace ?? '') ||
    !/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(entry.name ?? '') ||
    !/^\d+\.\d+\.\d+$/.test(entry.version ?? ''),
  )) {
    throw new Error('The npm release plan contains an invalid package identity.')
  }
  const packages = []

  for (const expected of plan.packages) {
    const { workspace } = expected
    const result = runNpm([
      'pack',
      '--workspace',
      workspace,
      '--pack-destination',
      outputDirectory,
      '--ignore-scripts',
      '--json',
    ])
    if (result.status !== 0) {
      throw new Error(`Unable to pack ${workspace}: ${result.stderr.trim()}`)
    }
    const [artifact] = JSON.parse(result.stdout || '[]')
    const filename = basename(artifact?.filename ?? '')
    if (
      artifact?.name !== expected.name ||
      artifact?.version !== expected.version ||
      !artifact?.integrity ||
      !filename.endsWith('.tgz') ||
      filename !== artifact.filename
    ) {
      throw new Error(`${workspace} produced invalid package metadata.`)
    }
    const integrity = await sha512Integrity(join(outputDirectory, filename))
    if (integrity !== artifact.integrity) {
      throw new Error(`${workspace} tarball integrity does not match npm pack.`)
    }
    packages.push({
      workspace,
      name: artifact.name,
      version: artifact.version,
      filename,
      integrity,
    })
  }

  const manifest = {
    schemaVersion: 2,
    planSha256: createHash('sha256').update(planBytes).digest('hex'),
    plan,
    packages,
  }
  await writeFile(
    join(outputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  return manifest
}

if (process.argv[1]?.endsWith('pack-release-workspaces.mjs')) {
  const outputDirectory = process.argv[2]
  const planPath = process.argv[3]
  await packReleaseWorkspaces({ outputDirectory, planPath })
}
