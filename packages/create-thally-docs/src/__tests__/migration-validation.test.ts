/** Migration gates must retain failures, including successful content with broken rendering. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ check: vi.fn(), build: vi.fn() }))
vi.mock('../check.js', () => ({ runCheck: mocks.check }))
vi.mock('node:child_process', () => ({ spawnSync: mocks.build }))
import { validateMigration } from '../migrate/validate.js'

function project(): string {
  const directory = mkdtempSync(join(tmpdir(), 'thally-migration-validation-'))
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ scripts: { build: 'next build' } }))
  return directory
}

describe('migration validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.check.mockResolvedValue(0)
    mocks.build.mockReturnValue({ status: 0 })
  })
  it('validates content without auto-fixing and runs the project production build', async () => {
    const directory = project()
    expect(await validateMigration(directory)).toMatchObject({ content: 'passed', build: 'passed' })
    expect(mocks.check).toHaveBeenCalledWith(directory, { fix: false, ci: true, onIssues: expect.any(Function) })
    expect(mocks.build).toHaveBeenCalledWith(expect.stringMatching(/^npm(?:\.cmd)?$/), ['run', 'build'], expect.objectContaining({ cwd: directory, stdio: 'inherit' }))
  })
  it('still tests rendering after broken links and returns both failures', async () => {
    const diagnostic = { severity: 'error', message: 'Broken link', file: 'src/content/start.mdx', line: 4 }
    mocks.check.mockImplementation(async (_directory, options) => { options.onIssues([diagnostic]); return 1 })
    mocks.build.mockReturnValue({ status: 1 })
    expect(await validateMigration(project())).toMatchObject({ content: 'failed', build: 'failed', diagnostics: [diagnostic] })
  })
  it('never describes explicitly skipped validation as passed', async () => {
    expect(await validateMigration(project(), true)).toMatchObject({ content: 'skipped', build: 'skipped' })
    expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.build).not.toHaveBeenCalled()
  })
  it('does not claim a build passed when an in-place project has no build script', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'thally-no-build-'))
    expect(await validateMigration(directory)).toMatchObject({ content: 'passed', build: 'skipped' })
    expect(mocks.build).not.toHaveBeenCalled()
  })
  it('retains static diagnostics after installation failure without attempting a build', async () => {
    const result = await validateMigration(project(), false, true)
    expect(result).toMatchObject({ content: 'passed', build: 'failed' })
    expect(result.messages.join(' ')).toContain('Dependency installation failed')
    expect(mocks.check).toHaveBeenCalledOnce()
    expect(mocks.build).not.toHaveBeenCalled()
  })
})
