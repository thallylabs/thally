/**
 * Add locally trusted exact release lookup to Core's offline shape/output check.
 * A catalog miss may be a newer release, so it warns without accusing a project
 * of tampering. Managed admission still requires authoritative exact identity.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkStarterIntegrity, type StarterIntegrityIssue } from '@thallylabs/core/starter-integrity'
import { SUPPORTED_SCAFFOLD_RELEASES, type ScaffoldRelease } from './release.js'
import { parseStarterReleaseManifest, starterManifestSha256 } from './starter-sync.js'

/** Check offline build invariants plus exact provenance known to this CLI. */
export function checkStarterProject(
  projectDir: string,
  releases: readonly ScaffoldRelease[] = SUPPORTED_SCAFFOLD_RELEASES,
): StarterIntegrityIssue[] {
  const issues = checkStarterIntegrity(projectDir)
  const file = 'starter-release.json', path = join(projectDir, file)
  if (!existsSync(path) || issues.some(issue => issue.file === file && issue.severity === 'error')) return issues
  try {
    const source = readFileSync(path, 'utf8')
    const known = releases.filter(release => release.source.manifestSha256 === starterManifestSha256(source))
    if (known.length) {
      for (const release of known) parseStarterReleaseManifest(source, release)
      return issues
    }
  } catch {
    // The file could change between checks, or a retained lookup be unavailable.
    // Neither authorizes a claim that a correctly shaped release was tampered.
  }
  return [...issues, { severity: 'warning', file,
    message: 'Cannot verify starter-release.json against this CLI\'s retained release catalog. Retry with the latest CLI or verify its exact provenance through a trusted release. Keep this file unchanged; runtime source customizations do not require editing it.' }]
}
