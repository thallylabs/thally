/**
 * Immutable source and runtime identity for every newly scaffolded Thally site.
 *
 * A release is promoted only after the source snapshot and its compiled runtime
 * have passed the scaffold, build, and identity-safety gates. Consumers must
 * use the whole record: independently resolving "latest template" and "latest
 * runtime" recreates the drift this contract exists to prevent.
 */

export interface ScaffoldSourceRelease {
  repository: string
  commitSha: string
  treeSha: string
  archiveUrl: string
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
 * The source commit is the refreshed public docs template and the runtime
 * commit is the matching engine change. `create-thally-docs`, the CLI, MCP,
 * and Thally Cloud all import this exact record rather than following a moving
 * branch independently.
 */
export const STABLE_SCAFFOLD_RELEASE = {
  schemaVersion: 1,
  id: '2026-08-04.b0094de4.e36d2bcf',
  source: {
    repository: 'thallylabs/docs',
    commitSha: 'b0094de4fea84567eb12c39c6783fdae6820bb98',
    treeSha: 'ffd0a6fda07341ddd1ba164cb40acef796f89e2d',
    archiveUrl:
      'https://codeload.github.com/thallylabs/docs/tar.gz/b0094de4fea84567eb12c39c6783fdae6820bb98',
  },
  runtime: {
    repository: 'thallylabs/thally',
    commitSha: 'e36d2bcff38f7638a77369e12773a7cab4d5d9ce',
    treeSha: '1c8b0358d78d8caa14ed039bff6ab47c98b685d8',
    contentSource: 'assets',
    identityContractVersion: 1,
  },
  starterVersion: 1,
} as const satisfies ScaffoldRelease

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
    candidate.runtime?.repository === STABLE_SCAFFOLD_RELEASE.runtime.repository &&
    candidate.runtime?.commitSha === STABLE_SCAFFOLD_RELEASE.runtime.commitSha &&
    candidate.runtime?.treeSha === STABLE_SCAFFOLD_RELEASE.runtime.treeSha &&
    candidate.runtime?.contentSource === STABLE_SCAFFOLD_RELEASE.runtime.contentSource &&
    candidate.runtime?.identityContractVersion ===
      STABLE_SCAFFOLD_RELEASE.runtime.identityContractVersion
  )
}
