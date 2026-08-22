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

const prerequisiteWorkspaces = ['packages/core', 'packages/migrate']
const scaffoldWorkspaces = [
  'packages/create-thally-docs',
  'packages/mcp',
  'packages/cli',
]

function runNpm(argumentsList) {
  return spawnSync('npm', argumentsList, { encoding: 'utf8' })
}

async function sha512Integrity(path) {
  const bytes = await readFile(path)
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

/** Pack and describe the exact package files selected for this release. */
export async function packReleaseWorkspaces({ outputDirectory, includeScaffold }) {
  if (!outputDirectory) throw new Error('An artifact output directory is required.')
  await mkdir(outputDirectory, { recursive: true })
  const workspaces = includeScaffold ? scaffoldWorkspaces : prerequisiteWorkspaces
  const packages = []

  for (const workspace of workspaces) {
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
      !artifact?.name ||
      !artifact?.version ||
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

  const manifest = { schemaVersion: 1, packages }
  await writeFile(
    join(outputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  return manifest
}

if (process.argv[1]?.endsWith('pack-release-workspaces.mjs')) {
  const outputDirectory = process.argv[2]
  const includeScaffold = process.argv.includes('--include-scaffold')
  await packReleaseWorkspaces({ outputDirectory, includeScaffold })
}
