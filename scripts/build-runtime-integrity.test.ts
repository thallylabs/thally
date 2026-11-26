/** Actual generator admission fails before deleting or replacing tracked output. */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'

it('reports reserved tracked outputs before any generator mutation', () => {
  const root = mkdtempSync(join(tmpdir(), 'thally-build-integrity-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: root })
    const path = 'public/_thally/content/keep.txt', sentinel = 'generated-body-must-not-be-logged'
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), sentinel)
    execFileSync('git', ['add', '--', path], { cwd: root })
    const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), join(process.cwd(), 'scripts/build-runtime-sources.mts')], {
      cwd: root, encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024,
    })
    expect(result.status).toBe(1)
    const output = result.stdout + result.stderr
    expect(output).toContain('Reserved generated runtime output is tracked in Git')
    expect(output).not.toContain(sentinel)
    expect(readFileSync(join(root, path), 'utf8')).toBe(sentinel)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
