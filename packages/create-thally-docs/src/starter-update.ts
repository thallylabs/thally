/**
 * User-reachable orchestration for immutable starter release updates.
 *
 * Projects carry the exact bytes of `starter-release.json`. The manifest hash
 * resolves the old release from the toolchain's retained immutable catalog;
 * neither the old nor new side follows a branch. Updates are dry-run by
 * default and advance provenance only after a confirmed, conflict-free apply.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { downloadStarter } from './download.js'
import {
  STABLE_SCAFFOLD_RELEASE,
  SUPPORTED_SCAFFOLD_RELEASES,
  type ScaffoldRelease,
} from './release.js'
import {
  applyStarterRuntimeSyncPlan,
  mergeStarterOwnershipContracts,
  parseStarterReleaseManifest,
  planStarterRuntimeSync,
  readStarterReleaseManifest,
  starterManifestSha256,
  type StarterRuntimeSyncPlan,
} from './starter-sync.js'

const EMPTY_PLAN: StarterRuntimeSyncPlan = {
  copyPaths: [],
  deletePaths: [],
  conflictPaths: [],
  manualReviewPaths: [],
  preservedPaths: [],
  unchangedPaths: [],
  targetPreconditions: {},
}

export interface StarterUpdateDownload {
  (targetDir: string, release: ScaffoldRelease): Promise<void>
}

export interface UpdateStarterProjectOptions {
  targetDir: string
  /** Applying is opt-in. Omitted/false always produces a dry-run plan. */
  apply?: boolean
  /** Separate acknowledgement for programmatic callers. */
  confirmed?: boolean
  targetRelease?: ScaffoldRelease
  releases?: readonly ScaffoldRelease[]
  download?: StarterUpdateDownload
}

export interface StarterUpdateResult {
  previousRelease: ScaffoldRelease
  targetRelease: ScaffoldRelease
  plan: StarterRuntimeSyncPlan
  isUpToDate: boolean
  applied: boolean
}

function readDownstreamManifest(targetDir: string, manifestPath: string): string {
  const path = join(targetDir, manifestPath)
  if (!existsSync(path)) {
    throw new Error(
      `This project has no ${manifestPath}; update it from a versioned Thally starter first.`,
    )
  }
  return readFileSync(path, 'utf8')
}

/** Resolve exact downstream provenance without consulting a moving branch. */
export function resolveStarterReleaseFromManifest(
  source: string,
  releases: readonly ScaffoldRelease[] = SUPPORTED_SCAFFOLD_RELEASES,
): ScaffoldRelease {
  const hash = starterManifestSha256(source)
  const matching = releases.filter(
    (release) => release.source.manifestSha256 === hash,
  )
  if (matching.length !== 1) {
    throw new Error(
      'The project starter manifest is edited, unknown, or ambiguously registered; refusing to update.',
    )
  }
  parseStarterReleaseManifest(source, matching[0])
  return matching[0]
}

function assertForwardRelease(
  previous: ScaffoldRelease,
  target: ScaffoldRelease,
): void {
  if (
    previous.source.repository !== target.source.repository ||
    previous.source.manifestPath !== target.source.manifestPath
  ) {
    throw new Error('Starter updates cannot cross repository or manifest contracts.')
  }
  if (
    previous.source.commitSha !== target.source.commitSha &&
    previous.starterVersion >= target.starterVersion
  ) {
    throw new Error('The installed CLI does not contain a newer starter release.')
  }
}

/**
 * Plan or explicitly apply an immutable three-way starter update.
 *
 * Direct GitHub-template copies need no generated state beyond the canonical
 * manifest: its pinned hash selects the old archive from the retained catalog.
 */
export async function updateStarterProject(
  options: UpdateStarterProjectOptions,
): Promise<StarterUpdateResult> {
  const targetRelease = options.targetRelease ?? STABLE_SCAFFOLD_RELEASE
  const releases = options.releases ?? SUPPORTED_SCAFFOLD_RELEASES
  const manifestPath = targetRelease.source.manifestPath
  const downstreamManifest = readDownstreamManifest(options.targetDir, manifestPath)
  const previousRelease = resolveStarterReleaseFromManifest(
    downstreamManifest,
    releases,
  )
  assertForwardRelease(previousRelease, targetRelease)

  if (previousRelease.source.commitSha === targetRelease.source.commitSha) {
    return {
      previousRelease,
      targetRelease,
      plan: EMPTY_PLAN,
      isUpToDate: true,
      applied: false,
    }
  }
  if (options.apply && !options.confirmed) {
    throw new Error('Pass explicit confirmation before applying a starter update.')
  }

  const workspace = mkdtempSync(join(tmpdir(), 'thally-starter-update-'))
  const oldStarterDir = join(workspace, 'old')
  const newStarterDir = join(workspace, 'new')
  mkdirSync(oldStarterDir)
  mkdirSync(newStarterDir)
  const download = options.download ?? (async (targetDir, release) => {
    await downloadStarter(targetDir, undefined, release, { announce: false })
  })

  try {
    await download(oldStarterDir, previousRelease)
    await download(newStarterDir, targetRelease)
    const oldManifest = readStarterReleaseManifest(oldStarterDir, previousRelease)
    const newManifest = readStarterReleaseManifest(newStarterDir, targetRelease)
    const ownership = mergeStarterOwnershipContracts(
      oldManifest.ownership,
      newManifest.ownership,
    )
    const plan = planStarterRuntimeSync(
      oldStarterDir,
      newStarterDir,
      options.targetDir,
      ownership,
    )

    if (!options.apply) {
      return {
        previousRelease,
        targetRelease,
        plan,
        isUpToDate: false,
        applied: false,
      }
    }
    if (plan.conflictPaths.length > 0) {
      throw new Error('Resolve starter synchronization conflicts before applying.')
    }

    // The manifest is special provenance, never a framework mutation. It joins
    // the filesystem transaction as the final atomic rename so a failed update
    // restores both the framework tree and its prior provenance.
    if (readDownstreamManifest(options.targetDir, manifestPath) !== downstreamManifest) {
      throw new Error('The project starter manifest changed during update planning.')
    }
    applyStarterRuntimeSyncPlan(
      newStarterDir,
      options.targetDir,
      plan,
      ownership,
      {
        confirmed: true,
        provenance: {
          sourcePath: join(newStarterDir, manifestPath),
          targetPath: join(options.targetDir, manifestPath),
          expectedSha256: previousRelease.source.manifestSha256,
        },
      },
    )

    return {
      previousRelease,
      targetRelease,
      plan,
      isUpToDate: false,
      applied: true,
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}
