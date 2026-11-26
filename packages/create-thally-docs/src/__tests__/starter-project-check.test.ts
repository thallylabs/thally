/** Offline checks distinguish unknown provenance from unsafe inputs. */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { appendStarterProvenanceIssues, checkStarterProject } from '../starter-project-check.js'
import { runCheck, type LintIssue } from '../check.js'
import { STABLE_SCAFFOLD_RELEASE } from '../release.js'
import { starterManifestSha256 } from '../starter-sync.js'

const directories: string[] = []
function project() {
  const root = mkdtempSync(join(tmpdir(), 'thally-project-check-')); directories.push(root)
  writeFileSync(join(root, 'docs.json'), '{"tabs":[{"tab":"Docs","href":"https://example.com"}]}\n')
  return root
}
function write(root: string, path: string, value: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value) }
const manifest = {
  schemaVersion: 1, starterVersion: STABLE_SCAFFOLD_RELEASE.starterVersion, repository: 'thallylabs/starter', defaultBranch: 'main',
  runtime: { ...STABLE_SCAFFOLD_RELEASE.runtime }, packages: { '@thallylabs/core': '^0.2.20' },
  ownership: { frameworkSyncEligible: ['src/lib/**'], userOwnedNeverOverwrite: ['src/content/**'], manualReview: [] },
}
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('starter project check', () => {
  it('accepts exact locally trusted manifest bytes without archives or network', () => {
    const root = project(), source = JSON.stringify(manifest)
    write(root, 'starter-release.json', source)
    const release = { ...STABLE_SCAFFOLD_RELEASE, source: { ...STABLE_SCAFFOLD_RELEASE.source, manifestSha256: starterManifestSha256(source) } }
    expect(checkStarterProject(root, [release])).toEqual([])
  })

  it('warns without blocking when safe provenance is outside the local catalog', async () => {
    const root = project()
    write(root, 'starter-release.json', JSON.stringify(manifest))
    const issues: LintIssue[] = []
    expect(await runCheck(root, { fix: false, ci: true, silent: true, checkStarterProvenance: appendStarterProvenanceIssues, onIssues: result => issues.push(...result) })).toBe(0)
    const provenance = issues.filter(issue => issue.file === 'starter-release.json')
    expect(provenance).toHaveLength(1)
    expect(provenance[0].severity).toBe('warning')
    expect(provenance[0].message).toContain('Cannot verify')
    expect(provenance[0].message).not.toMatch(/tamper|edited|fraud/i)
  })

  it('keeps exact release-catalog diagnostics wired into the real CLI', () => {
    const root = project()
    write(root, 'starter-release.json', JSON.stringify(manifest))
    const result = spawnSync(process.execPath, [
      '--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../index.ts', import.meta.url)),
      'check', root, '--ci',
    ], { encoding: 'utf8', timeout: 15_000, maxBuffer: 256 * 1024 })
    expect(result.status).toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('Cannot verify starter-release.json')
    expect(`${result.stdout}${result.stderr}`.match(/Cannot verify starter-release.json/g)).toHaveLength(1)
  })

  it('reports malformed provenance without echoing its source', async () => {
    const root = project(), sentinel = 'sensitive-manifest-source-sentinel'
    write(root, 'starter-release.json', sentinel)
    const issues: LintIssue[] = []
    expect(await runCheck(root, { fix: false, ci: true, silent: true, onIssues: result => issues.push(...result) })).toBe(1)
    expect(issues).toContainEqual(expect.objectContaining({ file: 'starter-release.json', severity: 'error' }))
    expect(JSON.stringify(issues)).not.toContain(sentinel)
  })

  it('flags tracked generated output while preserving custom source and date maps', async () => {
    const root = project()
    execFileSync('git', ['init', '-q'], { cwd: root })
    write(root, 'src/data/docs.ts', 'custom source sentinel')
    write(root, 'src/generated/page-dates.json', '{}')
    write(root, '.thally/page-updates.json', '{}')
    write(root, 'src/generated/runtime-sources.ts', 'generated source sentinel')
    execFileSync('git', ['add', '--', 'src/data/docs.ts', 'src/generated/page-dates.json', '.thally/page-updates.json'], { cwd: root })
    expect(checkStarterProject(root)).toEqual([])
    execFileSync('git', ['add', '--', 'src/generated/runtime-sources.ts'], { cwd: root })
    const issues: LintIssue[] = []
    expect(await runCheck(root, { fix: false, ci: true, silent: true, onIssues: result => issues.push(...result) })).toBe(1)
    expect(issues).toContainEqual(expect.objectContaining({ file: 'src/generated/runtime-sources.ts', severity: 'error' }))
    expect(JSON.stringify(issues)).not.toContain('generated source sentinel')
    expect(readFileSync(join(root, 'src/data/docs.ts'), 'utf8')).toBe('custom source sentinel')
  })
})
