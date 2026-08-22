/**
 * Bump the publishable Thally package chain as one atomic manifest update.
 *
 * `npm version` updates one workspace at a time and asks npm to resolve the
 * still-unpublished version pinned by the remaining workspaces. Computing all
 * versions first keeps the local dependency graph valid before npm refreshes
 * the lockfile.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PACKAGE_PATHS = Object.freeze({
  core: 'packages/core/package.json',
  migrate: 'packages/migrate/package.json',
  create: 'packages/create-thally-docs/package.json',
  mcp: 'packages/mcp/package.json',
  cli: 'packages/cli/package.json',
})

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
 * Increment every publishable package and repin internal dependencies before
 * any manifest is written.
 */
export function bumpReleasePackages(rootDirectory = process.cwd()) {
  const core = readPackage(rootDirectory, PACKAGE_PATHS.core)
  const migrate = readPackage(rootDirectory, PACKAGE_PATHS.migrate)
  const create = readPackage(rootDirectory, PACKAGE_PATHS.create)
  const mcp = readPackage(rootDirectory, PACKAGE_PATHS.mcp)
  const cli = readPackage(rootDirectory, PACKAGE_PATHS.cli)

  const versions = {
    core: incrementPatch(core.manifest.version, core.manifest.name),
    migrate: incrementPatch(migrate.manifest.version, migrate.manifest.name),
    create: incrementPatch(create.manifest.version, create.manifest.name),
    mcp: incrementPatch(mcp.manifest.version, mcp.manifest.name),
    cli: incrementPatch(cli.manifest.version, cli.manifest.name),
  }

  core.manifest.version = versions.core
  migrate.manifest.version = versions.migrate
  create.manifest.version = versions.create
  mcp.manifest.version = versions.mcp
  cli.manifest.version = versions.cli
  create.manifest.dependencies['@thallylabs/migrate'] = versions.migrate
  mcp.manifest.dependencies['create-thally-docs'] = versions.create
  cli.manifest.dependencies['create-thally-docs'] = versions.create
  cli.manifest.dependencies['@thallylabs/mcp'] = versions.mcp

  for (const packageRecord of [core, migrate, create, mcp, cli]) writePackage(packageRecord)

  return versions
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const versions = bumpReleasePackages()
  console.log(
    `Prepared @thallylabs/core@${versions.core}, @thallylabs/migrate@${versions.migrate}, create-thally-docs@${versions.create}, @thallylabs/mcp@${versions.mcp}, and @thallylabs/cli@${versions.cli}.`,
  )
}
