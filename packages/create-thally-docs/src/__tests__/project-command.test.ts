/** Quiet subprocesses retain bounded failure diagnostics and enforce build timeouts. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { terminal } from '../terminal.js'
import { previewCommand, quoteDirectory, runProjectCommand } from '../utils.js'

afterEach(() => vi.restoreAllMocks())

describe('project subprocess output', () => {
  it('offers one chained preview command, including skipped installation when needed', () => {
    const directory = "/tmp/docs owner's site"
    expect(previewCommand(directory)).toBe(`cd ${quoteDirectory(directory)} && npm run dev`)
    expect(previewCommand(directory, true)).toBe(`cd ${quoteDirectory(directory)} && npm install && npm run dev`)
    expect(previewCommand(directory)).not.toContain('\n')
  })

  it('retains both streams from a failed quiet command', async () => {
    vi.spyOn(terminal, 'isRich', 'get').mockReturnValue(true)
    vi.spyOn(terminal, 'isVerbose', 'get').mockReturnValue(false)
    const failure = await runProjectCommand(process.execPath, ['-e', "console.log('build context'); console.error('missing component'); process.exitCode = 1"], process.cwd()).catch(error => error)
    expect(failure.message).toContain('exit 1')
    expect(failure.output).toContain('build context')
    expect(failure.output).toContain('missing component')
  })

  it('bounds captured output while retaining the useful tail', async () => {
    vi.spyOn(terminal, 'isRich', 'get').mockReturnValue(true)
    vi.spyOn(terminal, 'isVerbose', 'get').mockReturnValue(false)
    const failure = await runProjectCommand(process.execPath, ['-e', "console.error('x'.repeat(100000) + ' final diagnostic'); process.exitCode = 1"], process.cwd()).catch(error => error)
    expect(failure.output.length).toBeLessThan(66000)
    expect(failure.output).toContain('Earlier output omitted')
    expect(failure.output).toContain('final diagnostic')
  })

  it('does not leave a hung build running after its timeout', async () => {
    vi.spyOn(terminal, 'isRich', 'get').mockReturnValue(true)
    const failure = await runProjectCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], process.cwd(), 50).catch(error => error)
    expect(failure.message).toContain('SIGTERM')
    expect(failure.message).toContain('Timed out after 50ms')
    expect(failure.exitCode).toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('terminates descendants that hold inherited build pipes open', async () => {
    vi.spyOn(terminal, 'isRich', 'get').mockReturnValue(true)
    const start = Date.now()
    const script = `const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }); setInterval(() => {}, 1000)`
    await expect(runProjectCommand(process.execPath, ['-e', script], process.cwd(), 100)).rejects.toThrow('SIGTERM')
    expect(Date.now() - start).toBeLessThan(1500)
  })

  it('quotes an absolute destination with spaces and apostrophes for the current shell', () => {
    if (process.platform !== 'win32') expect(quoteDirectory("/tmp/docs owner's site")).toBe("'/tmp/docs owner'\\''s site'")
  })
})
