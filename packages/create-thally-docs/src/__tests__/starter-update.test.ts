/** End-to-end orchestration coverage for immutable starter updates. */

import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  STABLE_SCAFFOLD_RELEASE,
  SUPPORTED_SCAFFOLD_RELEASES,
  type ScaffoldOwnershipContract,
  type ScaffoldRelease,
  type StarterReleaseManifest,
} from '../release.js'
import { starterManifestSha256 } from '../starter-sync.js'
import {
  resolveStarterReleaseFromManifest,
  updateStarterProject,
  type StarterUpdateDownload,
} from '../starter-update.js'

const directories: string[] = []

function directory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  directories.push(path)
  return path
}

function write(root: string, path: string, source: string): void {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, source, 'utf8')
}

const oldOwnership: ScaffoldOwnershipContract = {
  frameworkSyncEligible: ['framework/**'],
  userOwnedNeverOverwrite: [
    'src/content/**',
    'src/mdx/custom-components.tsx',
    'snippets/**',
    'framework/owner.ts',
  ],
  manualReview: ['next.config.ts'],
}

const newOwnership: ScaffoldOwnershipContract = {
  frameworkSyncEligible: ['framework/**'],
  userOwnedNeverOverwrite: [
    'src/content/**',
    'src/mdx/custom-components.tsx',
    'snippets/**',
  ],
  manualReview: ['next.config.ts', 'framework/manual.ts'],
}

function releaseFixture(
  version: number,
  ownership: ScaffoldOwnershipContract,
  /** Distinguishes multiple promoted releases of the same starterVersion. */
  revision = 0,
): { release: ScaffoldRelease; manifestSource: string; tree: string } {
  const label = revision === 0 ? `${version}` : `${version}.${revision}`
  const commitSha = `${String(version).repeat(39)}${revision}`
  const runtimeSha = `${String(version + 2).repeat(39)}${revision}`
  const manifest: StarterReleaseManifest = {
    schemaVersion: 1,
    starterVersion: version,
    repository: 'thallylabs/starter',
    defaultBranch: 'main',
    runtime: {
      repository: 'thallylabs/thally',
      commitSha: runtimeSha,
      treeSha: `runtime-tree-${label}`,
    },
    packages: {
      next: `${version}.${revision}.0`,
      '@thallylabs/core': `${version}.${revision}.0`,
    },
    ownership,
  }
  const manifestSource = `${JSON.stringify(manifest, null, 2)}\n`
  const tree = directory(`thally-release-${label}-`)
  write(tree, 'starter-release.json', manifestSource)
  write(
    tree,
    'package.json',
    `${JSON.stringify({
      name: 'thally-starter',
      dependencies: {
        next: `${version}.${revision}.0`,
        '@thallylabs/core': `${version}.${revision}.0`,
      },
    }, null, 2)}\n`,
  )
  write(tree, 'framework/runtime.ts', `runtime ${label}\n`)
  write(tree, 'framework/owner.ts', `starter owner ${label}\n`)
  write(tree, 'framework/manual.ts', `manual ${label}\n`)
  write(tree, 'next.config.ts', `config ${label}\n`)
  write(tree, 'src/content/index.mdx', `customer content ${label}\n`)
  const release: ScaffoldRelease = {
    schemaVersion: 1,
    id: `starter-${label}`,
    starterVersion: version,
    source: {
      repository: 'thallylabs/starter',
      commitSha,
      treeSha: `starter-tree-${label}`,
      archiveUrl: `https://example.invalid/starter-${label}.tar.gz`,
      manifestPath: 'starter-release.json',
      manifestSha256: starterManifestSha256(manifestSource),
    },
    runtime: {
      repository: 'thallylabs/thally',
      commitSha: runtimeSha,
      treeSha: `runtime-tree-${label}`,
      contentSource: 'assets',
      identityContractVersion: 1,
    },
  }
  return { release, manifestSource, tree }
}

function copyTree(source: string, target: string): void {
  for (const entry of readdirSync(source)) {
    cpSync(join(source, entry), join(target, entry), { recursive: true })
  }
}

function fixtureDownload(
  fixtures: ReadonlyMap<string, string>,
): StarterUpdateDownload {
  return async (targetDir, release) => {
    const source = fixtures.get(release.source.commitSha)
    if (!source) throw new Error('missing fixture release')
    copyTree(source, targetDir)
  }
}

afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('retained release catalog', () => {
  // Same-starterVersion forwardness is decided purely by catalog position, so
  // the shipped catalog must stay newest-first or the downgrade guard inverts.
  it('keeps the shipped catalog newest-first', () => {
    expect(SUPPORTED_SCAFFOLD_RELEASES[0]).toBe(STABLE_SCAFFOLD_RELEASE)
    for (let i = 1; i < SUPPORTED_SCAFFOLD_RELEASES.length; i += 1) {
      expect(SUPPORTED_SCAFFOLD_RELEASES[i].starterVersion)
        .toBeLessThanOrEqual(SUPPORTED_SCAFFOLD_RELEASES[i - 1].starterVersion)
    }
  })
})

describe('immutable starter update orchestration', () => {
  it('resolves a direct GitHub-template copy from manifest-only provenance', async () => {
    const old = releaseFixture(1, oldOwnership)
    const next = releaseFixture(2, newOwnership)
    const target = directory('thally-direct-template-')
    copyTree(old.tree, target)

    expect(
      resolveStarterReleaseFromManifest(old.manifestSource, [
        old.release,
        next.release,
      ]),
    ).toEqual(old.release)

    const result = await updateStarterProject({
      targetDir: target,
      releases: [old.release, next.release],
      targetRelease: next.release,
      download: fixtureDownload(new Map([
        [old.release.source.commitSha, old.tree],
        [next.release.source.commitSha, next.tree],
      ])),
    })

    expect(result.applied).toBe(false)
    expect(result.plan.copyPaths).toEqual(['framework/runtime.ts'])
    expect(result.plan.manualReviewPaths).toEqual([
      'framework/manual.ts',
      'next.config.ts',
    ])
    expect(readFileSync(join(target, 'starter-release.json'), 'utf8')).toBe(
      old.manifestSource,
    )
  })

  it('preserves old protected policy and reports two-sided customer conflicts', async () => {
    const old = releaseFixture(1, oldOwnership)
    const next = releaseFixture(2, newOwnership)
    const target = directory('thally-customer-conflict-')
    copyTree(old.tree, target)
    write(target, 'framework/runtime.ts', 'customer runtime edit\n')
    write(target, 'framework/owner.ts', 'customer owner edit\n')

    const result = await updateStarterProject({
      targetDir: target,
      releases: [old.release, next.release],
      targetRelease: next.release,
      download: fixtureDownload(new Map([
        [old.release.source.commitSha, old.tree],
        [next.release.source.commitSha, next.tree],
      ])),
    })

    expect(result.plan.conflictPaths).toEqual(['framework/runtime.ts'])
    expect(result.plan.copyPaths).not.toContain('framework/owner.ts')
    await expect(updateStarterProject({
      targetDir: target,
      releases: [old.release, next.release],
      targetRelease: next.release,
      download: fixtureDownload(new Map([
        [old.release.source.commitSha, old.tree],
        [next.release.source.commitSha, next.tree],
      ])),
      apply: true,
      confirmed: true,
    })).rejects.toThrow('Resolve starter synchronization conflicts')
    expect(readFileSync(join(target, 'starter-release.json'), 'utf8')).toBe(
      old.manifestSource,
    )
  })

  it('applies a clean plan and advances provenance only after success', async () => {
    const old = releaseFixture(1, oldOwnership)
    const next = releaseFixture(2, newOwnership)
    const target = directory('thally-clean-update-')
    copyTree(old.tree, target)

    const result = await updateStarterProject({
      targetDir: target,
      releases: [old.release, next.release],
      targetRelease: next.release,
      download: fixtureDownload(new Map([
        [old.release.source.commitSha, old.tree],
        [next.release.source.commitSha, next.tree],
      ])),
      apply: true,
      confirmed: true,
    })

    expect(result.applied).toBe(true)
    expect(readFileSync(join(target, 'framework/runtime.ts'), 'utf8')).toBe(
      'runtime 2\n',
    )
    expect(readFileSync(join(target, 'framework/owner.ts'), 'utf8')).toBe(
      'starter owner 1\n',
    )
    expect(readFileSync(join(target, 'starter-release.json'), 'utf8')).toBe(
      next.manifestSource,
    )
  })

  it('updates forward between retained releases of the same starterVersion', async () => {
    const base = releaseFixture(2, newOwnership)
    const promoted = releaseFixture(2, newOwnership, 1)
    const target = directory('thally-same-version-forward-')
    copyTree(base.tree, target)
    // Newest-first catalog order, exactly as promotion prepends releases.
    const releases = [promoted.release, base.release]

    const result = await updateStarterProject({
      targetDir: target,
      releases,
      targetRelease: promoted.release,
      download: fixtureDownload(new Map([
        [base.release.source.commitSha, base.tree],
        [promoted.release.source.commitSha, promoted.tree],
      ])),
      apply: true,
      confirmed: true,
    })

    expect(result.isUpToDate).toBe(false)
    expect(result.applied).toBe(true)
    expect(readFileSync(join(target, 'framework/runtime.ts'), 'utf8')).toBe(
      'runtime 2.1\n',
    )
    expect(readFileSync(join(target, 'starter-release.json'), 'utf8')).toBe(
      promoted.manifestSource,
    )
  })

  it('rejects a same-starterVersion downgrade to an older retained release', async () => {
    const base = releaseFixture(2, newOwnership)
    const promoted = releaseFixture(2, newOwnership, 1)
    const target = directory('thally-same-version-downgrade-')
    copyTree(promoted.tree, target)

    await expect(updateStarterProject({
      targetDir: target,
      releases: [promoted.release, base.release],
      targetRelease: base.release,
      download: fixtureDownload(new Map([
        [base.release.source.commitSha, base.tree],
        [promoted.release.source.commitSha, promoted.tree],
      ])),
    })).rejects.toThrow('does not contain a newer starter release')
    expect(readFileSync(join(target, 'starter-release.json'), 'utf8')).toBe(
      promoted.manifestSource,
    )
  })

  it('rejects a same-starterVersion target that is not in the retained catalog', async () => {
    const base = releaseFixture(2, newOwnership)
    const unregistered = releaseFixture(2, newOwnership, 1)
    const target = directory('thally-same-version-unregistered-')
    copyTree(base.tree, target)

    await expect(updateStarterProject({
      targetDir: target,
      releases: [base.release],
      targetRelease: unregistered.release,
      download: fixtureDownload(new Map([
        [base.release.source.commitSha, base.tree],
        [unregistered.release.source.commitSha, unregistered.tree],
      ])),
    })).rejects.toThrow('does not contain a newer starter release')
  })

  it('still updates across starterVersions when the catalog retains same-version releases', async () => {
    const old = releaseFixture(1, oldOwnership)
    const base = releaseFixture(2, newOwnership)
    const promoted = releaseFixture(2, newOwnership, 1)
    const target = directory('thally-cross-version-forward-')
    copyTree(old.tree, target)

    const result = await updateStarterProject({
      targetDir: target,
      releases: [promoted.release, base.release, old.release],
      targetRelease: promoted.release,
      download: fixtureDownload(new Map([
        [old.release.source.commitSha, old.tree],
        [promoted.release.source.commitSha, promoted.tree],
      ])),
    })

    expect(result.isUpToDate).toBe(false)
    expect(result.plan.copyPaths).toContain('framework/runtime.ts')
  })

  it('refuses a customer-edited manifest and unconfirmed apply', async () => {
    const old = releaseFixture(1, oldOwnership)
    const next = releaseFixture(2, newOwnership)
    const target = directory('thally-manifest-edit-')
    copyTree(old.tree, target)
    write(target, 'starter-release.json', `${old.manifestSource.trim()} \n`)

    await expect(updateStarterProject({
      targetDir: target,
      releases: [old.release, next.release],
      targetRelease: next.release,
    })).rejects.toThrow('edited, unknown, or ambiguously registered')

    write(target, 'starter-release.json', old.manifestSource)
    await expect(updateStarterProject({
      targetDir: target,
      releases: [old.release, next.release],
      targetRelease: next.release,
      apply: true,
      confirmed: false,
    })).rejects.toThrow('explicit confirmation')
  })
})
