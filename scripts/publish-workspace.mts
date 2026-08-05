/**
 * Publish one allowlisted workspace through npm trusted publishing.
 *
 * Retries are safe only when the registry tarball exactly matches the package
 * produced by this checkout. A pre-existing version with different integrity
 * is a hard failure; npm versions are immutable and must never be papered over.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

interface PackageManifest {
  name: string
  version: string
}

interface PackResult {
  name: string
  version: string
  integrity: string
}

const allowedWorkspaces = new Set([
  'packages/create-thally-docs',
  'packages/mcp',
  'packages/cli',
])

const workspace = process.argv[2]
const isVerifyOnly = process.argv.includes('--verify-only')

if (!workspace || !allowedWorkspaces.has(workspace)) {
  throw new Error('Pass an allowlisted publish workspace.')
}

function runNpm(args: string[], options: { inherit?: boolean } = {}) {
  return spawnSync('npm', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
  })
}

async function registryIntegrity(spec: string): Promise<string | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = runNpm(['view', spec, 'dist.integrity', '--json'])
    if (result.status === 0) {
      const value = JSON.parse(result.stdout || 'null') as unknown
      return typeof value === 'string' && value ? value : null
    }
    if (!result.stderr.includes('E404')) {
      throw new Error(`Unable to inspect ${spec}: ${result.stderr.trim()}`)
    }
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  return null
}

const manifest = JSON.parse(
  await readFile(join(process.cwd(), workspace, 'package.json'), 'utf8'),
) as PackageManifest
if (!manifest.name || !manifest.version) {
  throw new Error(`${workspace} has no publishable name and version.`)
}

const pack = runNpm(['pack', '--workspace', workspace, '--dry-run', '--json'])
if (pack.status !== 0) {
  throw new Error(`Unable to package ${workspace}: ${pack.stderr.trim()}`)
}
const [artifact] = JSON.parse(pack.stdout || '[]') as PackResult[]
if (
  !artifact ||
  artifact.name !== manifest.name ||
  artifact.version !== manifest.version ||
  !artifact.integrity
) {
  throw new Error(`${workspace} produced invalid package metadata.`)
}

const spec = `${manifest.name}@${manifest.version}`
const existingIntegrity = await registryIntegrity(spec)
if (existingIntegrity) {
  if (existingIntegrity !== artifact.integrity) {
    throw new Error(`${spec} exists with different package integrity.`)
  }
  console.info(`${spec} already matches this checkout; skipping publish.`)
} else {
  if (isVerifyOnly) throw new Error(`${spec} is not published.`)
  const publish = runNpm(
    ['publish', '--workspace', workspace, '--access', 'public'],
    { inherit: true },
  )
  if (publish.status !== 0) throw new Error(`Publishing ${spec} failed.`)
}

const publishedIntegrity = await registryIntegrity(spec)
if (publishedIntegrity !== artifact.integrity) {
  throw new Error(`${spec} did not settle with the expected package integrity.`)
}
console.info(`${spec} verified at ${artifact.integrity}.`)
