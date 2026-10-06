/** Migration gates must retain failures, including successful content with broken rendering. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ check: vi.fn(), build: vi.fn() }))
vi.mock('../migration-work.js', () => ({ checkContent: mocks.check }))
vi.mock('../utils.js', () => ({ runProjectCommand: mocks.build }))
import { validateMigration } from '../migrate/validate.js'

function project(): string {
  const directory = mkdtempSync(join(tmpdir(), 'thally-migration-validation-'))
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ scripts: { build: 'next build' } }))
  return directory
}

describe('migration validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.check.mockResolvedValue({ code: 0, diagnostics: [] })
    mocks.build.mockResolvedValue(undefined)
  })
  it('validates content without auto-fixing and runs the project production build', async () => {
    const directory = project()
    expect(await validateMigration(directory)).toMatchObject({ content: 'passed', build: 'passed' })
    expect(mocks.check).toHaveBeenCalledWith(directory)
    expect(mocks.build).toHaveBeenCalledWith('npm', ['run', 'build'], directory, 10 * 60 * 1000, expect.any(Function))
  })
  it('still tests rendering after broken links and returns both failures', async () => {
    const diagnostic = { severity: 'error', message: 'Broken link', file: 'src/content/start.mdx', line: 4 }
    mocks.check.mockResolvedValue({ code: 1, diagnostics: [diagnostic] })
    mocks.build.mockRejectedValue(new Error('Build failed'))
    expect(await validateMigration(project())).toMatchObject({ content: 'failed', build: 'failed', diagnostics: [diagnostic] })
  })
  it('retains a timed-out build as failed validation so the migration report can be saved', async () => {
    mocks.build.mockRejectedValue(new Error('npm run build failed (SIGTERM). Timed out after 600000ms.'))
    await expect(validateMigration(project())).resolves.toMatchObject({ content: 'passed', build: 'failed', messages: [expect.stringContaining('Timed out')] })
  })
  it('stops the workflow on build cancellation instead of retaining it as a validation failure', async () => {
    mocks.build.mockRejectedValue(Object.assign(new Error('Interrupted'), { exitCode: 130 }))
    await expect(validateMigration(project())).rejects.toMatchObject({ exitCode: 130 })
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
