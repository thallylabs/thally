/**
 * Derive an npm release from the actual workspace graph and an immutable git diff.
 *
 * A package changed since the release base must carry a new version before any
 * job can pack it. Private workspaces have an explicit non-publishable disposition.
 * Published workspace dependencies use exact versions so a release cannot point
 * at an unpublished or stale sibling by accident.
 */

import { spawnSync } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const RELEASE_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/
const WORKSPACE_PATTERN = /^packages\/[^/]+$/

function stableVersion(version, name) {
  const match = VERSION_PATTERN.exec(version ?? '')
  if (!match) throw new Error(`${name} must use a stable semantic version.`)
  return match.slice(1).map(Number)
}

function isNewerVersion(current, previous, name) {
  const next = stableVersion(current, name)
  const old = stableVersion(previous, name)
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== old[index]) return next[index] > old[index]
  }
  return false
}

function runGit(rootDirectory, args) {
  const result = spawnSync('git', args, {
    cwd: rootDirectory,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`Unable to inspect release source: ${result.stderr.trim()}`)
  }
  return result.stdout
}

function requireWorkspace(workspace) {
  if (!WORKSPACE_PATTERN.test(workspace)) {
    throw new Error(`Invalid release workspace: ${workspace}`)
  }
}

/** Plan every changed publishable workspace, in dependency-first order. */
export function planPackageRelease({ currentPackages, previousPackages, changedPaths, lockfile }) {
  const currentByWorkspace = new Map(currentPackages.map((entry) => [entry.workspace, entry.manifest]))
  const previousByWorkspace = new Map(previousPackages.map((entry) => [entry.workspace, entry.manifest]))
  const currentByName = new Map()
  const changedWorkspaces = new Set()

  for (const path of changedPaths) {
    const match = /^(packages\/[^/]+)\//.exec(path)
    if (match) changedWorkspaces.add(match[1])
  }
  for (const [workspace, manifest] of currentByWorkspace) {
    requireWorkspace(workspace)
    if (!manifest?.name || (manifest.private !== true && !manifest.version) || currentByName.has(manifest.name)) {
      throw new Error(`${workspace} has a missing or duplicate package identity.`)
    }
    if (manifest.private !== true) stableVersion(manifest.version, manifest.name)
    currentByName.set(manifest.name, { workspace, manifest })
  }

  const dispositions = []
  const selected = new Map()
  for (const workspace of [...new Set([...previousByWorkspace.keys(), ...currentByWorkspace.keys()])].sort()) {
    const current = currentByWorkspace.get(workspace)
    const previous = previousByWorkspace.get(workspace)
    const isChanged = changedWorkspaces.has(workspace)
    if (!current) {
      if (previous?.private !== true) {
        throw new Error(`Removed publishable workspace ${workspace} needs a separate sunset plan.`)
      }
      continue
    }
    const disposition = current.private === true ? 'nonpublishable' : isChanged ? 'publish' : 'unchanged'
    dispositions.push({ workspace, name: current.name, version: current.version, disposition })
    if (disposition !== 'publish') continue
    if (previous && (previous.name !== current.name || !isNewerVersion(current.version, previous.version, current.name))) {
      throw new Error(`${workspace} changed without a newer package version.`)
    }
    selected.set(current.name, { workspace, name: current.name, version: current.version })
  }

  for (const { workspace, manifest } of currentByName.values()) {
    if (manifest.private === true) continue
    const locked = lockfile?.packages?.[workspace]
    const link = lockfile?.packages?.[`node_modules/${manifest.name}`]
    if (locked?.version !== manifest.version || link?.resolved !== workspace || link?.link !== true) {
      throw new Error(`${workspace} does not match the root package lockfile.`)
    }
    for (const field of RELEASE_DEPENDENCY_FIELDS) {
      const dependencies = manifest[field] ?? {}
      if (!isDeepStrictEqual(locked[field] ?? {}, dependencies)) {
        throw new Error(`${workspace} ${field} does not match the root package lockfile.`)
      }
      for (const [name, range] of Object.entries(dependencies)) {
        const dependency = currentByName.get(name)
        if (!dependency) continue
        if (dependency.manifest.private === true) {
          throw new Error(`${workspace} cannot publish a runtime dependency on private ${name}.`)
        }
        if (range !== dependency.manifest.version) {
          throw new Error(`${workspace} must pin ${name}@${dependency.manifest.version}.`)
        }
      }
    }
  }

  const ordered = []
  const pending = new Set(selected.keys())
  while (pending.size > 0) {
    const ready = [...pending].filter((name) => {
      const packageEntry = currentByName.get(name)
      return RELEASE_DEPENDENCY_FIELDS.every((field) =>
        Object.keys(packageEntry.manifest[field] ?? {}).every((dependency) => !pending.has(dependency)),
      )
    }).sort()
    if (ready.length === 0) throw new Error('Package dependency graph contains a cycle.')
    const next = ready[0]
    pending.delete(next)
    ordered.push(selected.get(next))
  }
  return { schemaVersion: 1, dispositions, packages: ordered }
}

async function readCurrentPackages(rootDirectory) {
  const entries = await readdir(join(rootDirectory, 'packages'), { withFileTypes: true })
  const packages = []
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const workspace = `packages/${entry.name}`
    const manifest = JSON.parse(await readFile(join(rootDirectory, workspace, 'package.json'), 'utf8'))
    packages.push({ workspace, manifest })
  }
  return packages
}

/** Read both manifest trees from git so the release plan never trusts event payload paths. */
export async function createReleasePlan(rootDirectory, baseRef, sourceRef = 'HEAD') {
  if (!/^[0-9a-f]{40}$/.test(baseRef) && baseRef !== 'HEAD^') {
    throw new Error('The release base must be an exact commit SHA or HEAD^.')
  }
  const baseSha = runGit(rootDirectory, ['rev-parse', '--verify', `${baseRef}^{commit}`]).trim()
  const sourceSha = runGit(rootDirectory, ['rev-parse', '--verify', `${sourceRef}^{commit}`]).trim()
  runGit(rootDirectory, ['merge-base', '--is-ancestor', baseSha, sourceSha])
  const changedPaths = runGit(rootDirectory, ['diff', '--name-only', '-z', baseSha, sourceSha, '--', 'packages/'])
    .split('\0').filter(Boolean)
  const previousPaths = runGit(rootDirectory, ['ls-tree', '-r', '--name-only', baseSha, '--', 'packages/'])
    .split('\n').filter((path) => /^packages\/[^/]+\/package\.json$/.test(path))
  const previousPackages = previousPaths.map((path) => ({
    workspace: path.slice(0, -'/package.json'.length),
    manifest: JSON.parse(runGit(rootDirectory, ['show', `${baseSha}:${path}`])),
  }))
  const currentPackages = await readCurrentPackages(rootDirectory)
  const lockfile = JSON.parse(await readFile(join(rootDirectory, 'package-lock.json'), 'utf8'))
  return {
    ...planPackageRelease({ currentPackages, previousPackages, changedPaths, lockfile }),
    baseSha,
    sourceSha,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argument = (name) => process.argv[process.argv.indexOf(name) + 1]
  const base = process.argv.includes('--base') ? argument('--base') : null
  const output = process.argv.includes('--output') ? argument('--output') : null
  const githubOutput = process.argv.includes('--github-output') ? argument('--github-output') : null
  if (!base || !output) throw new Error('Pass --base and --output for an immutable release plan.')
  const plan = await createReleasePlan(process.cwd(), base)
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`)
  if (githubOutput) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(githubOutput, `has_packages=${plan.packages.length > 0}\n`)
  }
  console.log(`Planned ${plan.packages.length} publishable packages from ${plan.baseSha} to ${plan.sourceSha}.`)
}
