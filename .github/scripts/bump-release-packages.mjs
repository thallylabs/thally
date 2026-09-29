/**
 * Bump the publishable Thally package chain as one atomic manifest update.
 *
 * `npm version` updates one workspace at a time and asks npm to resolve the
 * still-unpublished version pinned by the remaining workspaces. Computing all
 * versions first keeps the local dependency graph valid before npm refreshes
 * the lockfile.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SCAFFOLD_RECORD_WORKSPACE = 'packages/create-thally-docs'
const RELEASE_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']

function readPackage(rootDirectory, packagePath) {
  const absolutePath = resolve(rootDirectory, packagePath)
  return {
    absolutePath,
    manifest: JSON.parse(readFileSync(absolutePath, 'utf8')),
  }
}

function incrementPatch(version, packageName) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) {
    throw new Error(`${packageName} must use a stable semantic version; received ${version}.`)
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

function writePackage({ absolutePath, manifest }) {
  writeFileSync(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * A new scaffold record changes create-thally-docs. Its publishable dependents
 * must be versioned too because their exact package ranges are embedded in npm
 * tarballs. Discover that closure from package manifests rather than a list.
 */
export function bumpReleasePackages(rootDirectory = process.cwd()) {
  const records = readdirSync(resolve(rootDirectory, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      workspace: `packages/${entry.name}`,
      ...readPackage(rootDirectory, join('packages', entry.name, 'package.json')),
    }))
  const byName = new Map(records.map((record) => [record.manifest.name, record]))
  const scaffold = records.find((record) => record.workspace === SCAFFOLD_RECORD_WORKSPACE)
  if (!scaffold || scaffold.manifest.private === true) {
    throw new Error('The scaffold record workspace must be publishable.')
  }
  const selected = new Set([scaffold.manifest.name])
  let changed = true
  while (changed) {
    changed = false
    for (const record of records) {
      if (record.manifest.private === true || selected.has(record.manifest.name)) continue
      const dependencies = RELEASE_DEPENDENCY_FIELDS.flatMap((field) =>
        Object.keys(record.manifest[field] ?? {}),
      )
      if (dependencies.some((name) => selected.has(name))) {
        selected.add(record.manifest.name)
        changed = true
      }
    }
  }
  const versions = {}
  for (const record of records.filter((item) => selected.has(item.manifest.name))) {
    versions[record.manifest.name] = incrementPatch(record.manifest.version, record.manifest.name)
  }
  for (const record of records.filter((item) => selected.has(item.manifest.name))) {
    record.manifest.version = versions[record.manifest.name]
    for (const field of RELEASE_DEPENDENCY_FIELDS) {
      for (const name of Object.keys(record.manifest[field] ?? {})) {
        if (versions[name]) record.manifest[field][name] = versions[name]
        else if (byName.get(name)?.manifest.private === true) {
          throw new Error(`${record.manifest.name} cannot publish a runtime dependency on private ${name}.`)
        }
      }
    }
  }
  for (const record of records.filter((item) => selected.has(item.manifest.name))) writePackage(record)
  return versions
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const versions = bumpReleasePackages()
  console.log(`Prepared ${Object.entries(versions).map(([name, version]) => `${name}@${version}`).join(', ')}.`)
}
