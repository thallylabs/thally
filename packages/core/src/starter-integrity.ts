/**
 * Offline Node preflight for reserved starter provenance and committed outputs.
 * This never prohibits editable runtime source or judges an unknown release's
 * authenticity. Exact release authorization belongs to a trusted catalog.
 */
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface StarterIntegrityIssue {
  severity: 'error' | 'warning'
  message: string
  file?: string
}

const reservedOutputs = [
  'public/_thally/content', 'src/generated/runtime-sources.ts',
  'src/generated/runtime-docs.ts', 'src/generated/runtime-docs',
]

/** Only platform output identities are reserved; customer date maps are valid. */
export function isReservedStarterOutput(path: string): boolean {
  return reservedOutputs.some(output => path === output || path.startsWith(`${output}/`))
}

function isRecord(item: unknown): item is Record<string, unknown> {
  return Boolean(item) && typeof item === 'object' && !Array.isArray(item)
}

function safeRule(value: unknown): boolean {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) return false
  const path = value.endsWith('/**') ? value.slice(0, -3) : value.endsWith('*') ? value.slice(0, -1) : value
  return !path.includes('*') && path.split('/').every(part => part && part !== '.' && part !== '..')
}

/** Validate only portable structure/safety, never manufacture trusted identity. */
export function isStarterProvenanceShape(value: unknown): boolean {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.starterVersion) || Number(value.starterVersion) < 1 ||
      value.repository !== 'thallylabs/starter' || value.defaultBranch !== 'main' || !isRecord(value.runtime) ||
      value.runtime.repository !== 'thallylabs/thally' ||
      typeof value.runtime.commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(value.runtime.commitSha) ||
      typeof value.runtime.treeSha !== 'string' || !/^[a-f0-9]{40}$/.test(value.runtime.treeSha) ||
      !isRecord(value.packages) || Object.keys(value.packages).length === 0 ||
      Object.entries(value.packages).some(([name, version]) => !name || typeof version !== 'string' || !version) ||
      !isRecord(value.ownership)) return false
  const ownership = value.ownership
  return ['frameworkSyncEligible', 'userOwnedNeverOverwrite', 'manualReview'].every(field => {
    const rules = ownership[field]
    return Array.isArray(rules) && (field === 'manualReview' || rules.length > 0) &&
      rules.every(safeRule) && new Set(rules).size === rules.length
  })
}

/** Read bounded safe provenance without fetching archives or consulting a branch. */
export function checkStarterIntegrity(projectDir: string): StarterIntegrityIssue[] {
  const issues: StarterIntegrityIssue[] = []
  const manifest = join(projectDir, 'starter-release.json')
  try {
    const stat = lstatSync(manifest)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error()
    const bytes = readFileSync(manifest), source = bytes.toString('utf8')
    if (source.includes('\0') || !Buffer.from(source, 'utf8').equals(bytes) || !isStarterProvenanceShape(JSON.parse(source))) throw new Error()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      issues.push({ severity: 'error', file: 'starter-release.json',
        message: 'starter-release.json must be a bounded regular UTF-8 file with valid starter provenance. Restore its exact bytes from the project\'s trusted starter release; keep customizations in source and configuration files.' })
    }
  }
  let tracked: string
  try {
    // Generated files normally exist after a build. Only Git's tracked inputs
    // are reserved; no Git means there is no tracked-output judgment to make.
    tracked = execFileSync('git', ['ls-files', '-z', '--', ...reservedOutputs], {
      cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2_000, maxBuffer: 1024 * 1024,
    })
  } catch {
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectDir, stdio: 'ignore', timeout: 2_000 })
      issues.push({ severity: 'error', message: 'Cannot inspect tracked generated outputs in this Git checkout. Restore a readable Git index and retry before building.' })
    } catch { /* No Git checkout: tracked-output validation does not apply. */ }
    return issues
  }
  const paths = [...new Set(tracked.split('\0').filter(isReservedStarterOutput))].sort()
  for (const path of paths) {
    // Prevent a Git filename containing control characters from injecting a CI
    // annotation; remediation still identifies its reserved output root.
    const file = /[\u0000-\u001f\u007f]/.test(path) ? reservedOutputs.find(output => path.startsWith(output))! : path
    issues.push({ severity: 'error', file,
      message: 'Reserved generated runtime output is tracked in Git. Remove it from the Git index and ignore it; the build recreates it. Keep authored content and custom source files in their normal locations.' })
  }
  return issues
}
