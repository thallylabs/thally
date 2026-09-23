/**
 * Install the exact packed release set outside the monorepo before attestation.
 *
 * A workspace install can hide missing npm dependencies behind local links. This
 * clean project instead resolves the selected tarballs and every non-selected
 * dependency through normal registry rules, with lifecycle scripts disabled.
 */

import { spawnSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

function entryTargets(value) {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(entryTargets)
}

/** Prove the tarballs install without workspace links and expose real entrypoints. */
export async function verifyReleaseInstall(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.packages) || manifest.packages.length === 0) {
    throw new Error('A non-empty release artifact manifest is required.')
  }
  for (const artifact of manifest.packages) {
    if (
      !/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(artifact.name ?? '') ||
      !/^[a-zA-Z0-9@._+-]+\.tgz$/.test(artifact.filename ?? '')
    ) {
      throw new Error('The release artifact contains an invalid npm package path.')
    }
  }
  const directory = await mkdtemp(join(tmpdir(), 'thally-package-install-'))
  try {
    await writeFile(join(directory, 'package.json'), '{"name":"thally-release-install","version":"1.0.0","private":true}\n')
    const tarballs = manifest.packages.map((artifact) => join(dirname(manifestPath), artifact.filename))
    const installed = spawnSync('npm', [
      'install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs,
    ], { cwd: directory, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    if (installed.status !== 0) {
      throw new Error(`The release tarballs did not clean-install: ${installed.stderr.trim()}`)
    }
    for (const artifact of manifest.packages) {
      const packageRoot = join(directory, 'node_modules', artifact.name)
      const packageManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
      if (packageManifest.name !== artifact.name || packageManifest.version !== artifact.version) {
        throw new Error(`${artifact.name} resolved to a different package in the clean install.`)
      }
      for (const target of [...entryTargets(packageManifest.exports), ...Object.values(packageManifest.bin ?? {})]) {
        if (typeof target !== 'string' || !/^(?:\.\/)?(?:dist\/|package\.json$)/.test(target) || target.includes('..')) {
          throw new Error(`${artifact.name} contains an invalid public entrypoint.`)
        }
        await access(join(packageRoot, target))
      }
    }
    console.info(`Clean-installed ${manifest.packages.length} release package(s).`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyReleaseInstall(process.argv[2])
}
