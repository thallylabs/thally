/**
 * Immutable source and runtime identity for every newly scaffolded Thally site.
 *
 * A release is promoted only after the source snapshot and its compiled runtime
 * have passed the scaffold, build, and identity-safety gates. Consumers must
 * use the whole record: independently resolving "latest template" and "latest
 * runtime" recreates the drift this contract exists to prevent.
 */

import stableScaffoldRelease from './stable-scaffold-release.json' with { type: 'json' }
import previousScaffoldReleases from './previous-scaffold-releases.json' with { type: 'json' }

export interface ScaffoldSourceRelease {
  repository: string
  commitSha: string
  treeSha: string
  archiveUrl: string
  manifestPath: 'starter-release.json'
  manifestSha256: string
}

export interface ScaffoldOwnershipContract {
  frameworkSyncEligible: readonly string[]
  userOwnedNeverOverwrite: readonly string[]
  manualReview: readonly string[]
}

export interface StarterReleaseManifest {
  schemaVersion: 1
  starterVersion: number
  repository: string
  defaultBranch: string
  runtime: Pick<ScaffoldRuntimeRelease, 'repository' | 'commitSha' | 'treeSha'>
  packages: Record<string, string>
  ownership: ScaffoldOwnershipContract
}

export interface ScaffoldRuntimeRelease {
  repository: string
  commitSha: string
  treeSha: string
  contentSource: 'assets'
  identityContractVersion: number
}

export interface ScaffoldRelease {
  schemaVersion: 1
  id: string
  source: ScaffoldSourceRelease
  runtime: ScaffoldRuntimeRelease
  starterVersion: number
}

/**
 * Current stable scaffold release.
 *
 * The source commit is the complete, standalone `thallylabs/starter` tree and
 * the runtime commit is the matching engine change. `create-thally-docs`, the
 * CLI, MCP, and Thally Cloud all import this exact record rather than following
 * a moving branch independently. Promotion replaces the placeholders in the
 * adjacent JSON record, which is also consumed by Cloud build parity checks.
 */
export const STABLE_SCAFFOLD_RELEASE = stableScaffoldRelease as ScaffoldRelease

/**
 * Immutable releases this toolchain can use as a three-way update base.
 *
 * Promotion prepends the new stable record but retains earlier records. That
 * lets a project created directly from GitHub carry only the exact manifest
 * bytes and still resolve its original starter without mutable branch state.
 */
export const SUPPORTED_SCAFFOLD_RELEASES: readonly ScaffoldRelease[] = [
  STABLE_SCAFFOLD_RELEASE,
  ...(previousScaffoldReleases as ScaffoldRelease[]),
]

/** True only when an unknown record is the currently supported release. */
export function isStableScaffoldRelease(value: unknown): value is ScaffoldRelease {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<ScaffoldRelease>
  return (
    candidate.schemaVersion === STABLE_SCAFFOLD_RELEASE.schemaVersion &&
    candidate.id === STABLE_SCAFFOLD_RELEASE.id &&
    candidate.starterVersion === STABLE_SCAFFOLD_RELEASE.starterVersion &&
    candidate.source?.repository === STABLE_SCAFFOLD_RELEASE.source.repository &&
    candidate.source?.commitSha === STABLE_SCAFFOLD_RELEASE.source.commitSha &&
    candidate.source?.treeSha === STABLE_SCAFFOLD_RELEASE.source.treeSha &&
    candidate.source?.archiveUrl === STABLE_SCAFFOLD_RELEASE.source.archiveUrl &&
    candidate.source?.manifestPath === STABLE_SCAFFOLD_RELEASE.source.manifestPath &&
    candidate.source?.manifestSha256 ===
      STABLE_SCAFFOLD_RELEASE.source.manifestSha256 &&
    candidate.runtime?.repository === STABLE_SCAFFOLD_RELEASE.runtime.repository &&
    candidate.runtime?.commitSha === STABLE_SCAFFOLD_RELEASE.runtime.commitSha &&
    candidate.runtime?.treeSha === STABLE_SCAFFOLD_RELEASE.runtime.treeSha &&
    candidate.runtime?.contentSource === STABLE_SCAFFOLD_RELEASE.runtime.contentSource &&
    candidate.runtime?.identityContractVersion ===
      STABLE_SCAFFOLD_RELEASE.runtime.identityContractVersion
  )
}
