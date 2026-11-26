/** Offline starter preflight judges tracked reserved identities, not custom code. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkStarterIntegrity, isStarterProvenanceShape } from '../starter-integrity.js'

const directories: string[] = []
function project(git = false) {
  const root = mkdtempSync(join(tmpdir(), 'thally-integrity-')); directories.push(root)
  if (git) execFileSync('git', ['init', '-q'], { cwd: root })
  return root
}
function write(root: string, path: string, content = 'source-content-sentinel') {
  mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content)
}
const manifest = {
  schemaVersion: 1, starterVersion: 3, repository: 'thallylabs/starter', defaultBranch: 'main',
  runtime: { repository: 'thallylabs/thally', commitSha: '1'.repeat(40), treeSha: '2'.repeat(40) },
  packages: { '@thallylabs/core': '^0.2.20' },
  ownership: { frameworkSyncEligible: ['src/lib/**'], userOwnedNeverOverwrite: ['src/content/**'], manualReview: [] },
}
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('offline starter integrity', () => {
  it('accepts edited source, custom date maps, caches and untracked build outputs', () => {
    const root = project(true)
    for (const path of ['src/data/docs.ts', 'src/generated/page-dates.json', '.thally/page-updates.json']) write(root, path)
    execFileSync('git', ['add', '--', 'src/data/docs.ts', 'src/generated/page-dates.json', '.thally/page-updates.json'], { cwd: root })
    for (const path of ['public/_thally/content/manifest.json', 'src/generated/runtime-sources.ts', 'src/generated/runtime-docs.ts', 'src/generated/runtime-docs/page.mjs']) write(root, path)
    write(root, 'starter-release.json', JSON.stringify(manifest))
    expect(checkStarterIntegrity(root)).toEqual([])
  })

  it('rejects only Git-tracked reserved output identities without reading source', () => {
    const root = project(true)
    const paths = ['public/_thally/content/manifest.json', 'src/generated/runtime-sources.ts', 'src/generated/runtime-docs.ts', 'src/generated/runtime-docs/page.mjs']
    for (const path of paths) write(root, path)
    execFileSync('git', ['add', '--', ...paths], { cwd: root })
    const issues = checkStarterIntegrity(root)
    expect(issues.map(issue => issue.file).sort()).toEqual(paths.sort())
    expect(issues.every(issue => issue.severity === 'error' && issue.message.includes('Git index'))).toBe(true)
    expect(JSON.stringify(issues)).not.toContain('source-content-sentinel')
    expect(readFileSync(join(root, paths[0]), 'utf8')).toBe('source-content-sentinel')
  })

  it('skips tracked-output judgments without Git while retaining shape validation', () => {
    const root = project()
    write(root, 'src/generated/runtime-sources.ts')
    expect(checkStarterIntegrity(root)).toEqual([])
    write(root, 'starter-release.json', 'malformed-secret-body')
    expect(checkStarterIntegrity(root)).toEqual([expect.objectContaining({ file: 'starter-release.json', severity: 'error' })])
    expect(JSON.stringify(checkStarterIntegrity(root))).not.toContain('malformed-secret-body')
  })

  it('rejects unsafe provenance shape, oversized bytes, binary and symlinks', () => {
    expect(isStarterProvenanceShape({ ...manifest, runtime: { ...manifest.runtime, commitSha: 'main' } })).toBe(false)
    expect(isStarterProvenanceShape({ ...manifest, ownership: { ...manifest.ownership, frameworkSyncEligible: ['../escape/**'] } })).toBe(false)
    for (const value of [Buffer.alloc(256 * 1024 + 1, 0x20), Buffer.from([0xff]), Buffer.from('{}\0')]) {
      const root = project(); writeFileSync(join(root, 'starter-release.json'), value)
      expect(checkStarterIntegrity(root)[0]?.severity).toBe('error')
    }
    const root = project(); symlinkSync(join(root, 'absent.json'), join(root, 'starter-release.json'))
    expect(checkStarterIntegrity(root)[0]?.severity).toBe('error')
  })
})
