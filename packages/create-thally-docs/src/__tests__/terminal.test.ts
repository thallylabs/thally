/** Terminal decoration must never corrupt CI transcripts or conceal source warnings. */
import { describe, expect, it, vi } from 'vitest'
import { createTerminal, PRODUCT_TAGLINE, terminal, terminalText, acquireTerminalAccent } from '../terminal.js'

function screen(isTTY = false, env: NodeJS.ProcessEnv = {}, argv: Array<string> = [], columns = 40) {
  const lines: Array<string> = []
  const diagnostics: Array<string> = []
  const terminal = createTerminal({
    stdout: { isTTY, columns, write: (chunk) => { lines.push(String(chunk)); return true } },
    stderr: { isTTY, columns, write: (chunk) => { diagnostics.push(String(chunk)); return true } },
    env, argv,
  })
  return { terminal, output: () => lines.join(''), errors: () => diagnostics.join('') }
}

describe('terminal transcript', () => {
  it.each([false, true])('keeps long preview commands intact in rich=%s output', (isTTY) => {
    const view = screen(isTTY)
    const command = `cd '/tmp/${'long-path/'.repeat(15)}docs' && npm run dev`
    view.terminal.nextAction('Preview locally', command)
    expect(terminalText(view.output())).toContain(command)
    expect(terminalText(view.output())).toContain('Preview locally')
    if (!isTTY) expect(view.output()).not.toContain('\x1b')
  })

  it.each([
    [{ COLORTERM: 'truecolor' }, '\x1b[38;2;174;187;106m'],
    [{ TERM: 'xterm-256color' }, '\x1b[38;5;143m'],
  ])('uses olive lettering for %j color capability', (env, expected) => {
    const view = screen(true, env, [], 80)
    view.terminal.intro('migrate')
    expect(view.output()).toContain(expected)
    expect(view.output()).not.toMatch(/\x1b\[(35|95)m/)
  })

  it('themes Clack accents while preserving diagnostics, callbacks, and nested scope cleanup', () => {
    const chunks: Array<string> = []
    vi.spyOn(terminal, 'isRich', 'get').mockReturnValue(true)
    vi.stubEnv('COLORTERM', 'truecolor')
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk, callback) => {
      chunks.push(String(chunk))
      if (typeof callback === 'function') callback()
      return true
    })
    const previous = process.stdout.write
    const callback = vi.fn()
    const release = acquireTerminalAccent()
    const releaseNested = acquireTerminalAccent()
    try {
      process.stdout.write('\x1b[35mworking\x1b[39m\x1b[33mwarn\x1b[31merror', callback)
      release()
      release() // Cleanup is idempotent, including nested cancellation paths.
      expect(process.stdout.write).not.toBe(previous)
      releaseNested()
      expect(process.stdout.write).toBe(previous)
      expect(callback).toHaveBeenCalledOnce()
      expect(chunks.join('')).toBe('\x1b[38;2;174;187;106mworking\x1b[39m\x1b[33mwarn\x1b[31merror')
    } finally {
      release()
      releaseNested()
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
    }
  })

  it.each([80, 40, 20])('fits the interactive wordmark within %i columns', (columns) => {
    const view = screen(true, {}, [], columns)
    view.terminal.intro('migrate', '1.0.0')
    const output = terminalText(view.output())
    const mark = output.split('\n\n')[0].trimEnd()
    for (const line of mark.split('\n')) expect(line.length).toBeLessThanOrEqual(columns)
    expect(output).toContain('migrate · v1.0.0')
    expect(output).toContain(PRODUCT_TAGLINE)
    if (columns === 80) expect(mark).toContain('████████╗')
    if (columns === 20) expect(mark).toContain('THALLY')
  })

  it.each([{ CI: 'true' }, { CI: '1' }, { TERM: 'dumb' }, { NO_COLOR: '' }])('keeps %j terminals append-only and undecorated', (env) => {
    const view = screen(true, env)
    view.terminal.intro('migrate', '1.0.0', 'Bring your docs to Thally.')
    view.terminal.warn('Review the quarantined files.')
    expect(view.output()).toContain(PRODUCT_TAGLINE)
    expect(view.output()).not.toMatch(/[\x1b\r]/)
    expect(view.errors()).toContain('[warn] Review the quarantined files.')
    expect(view.output()).not.toContain('quarantined')
  })

  it('retains asynchronous task outcomes without claiming a failed step succeeded', async () => {
    const view = screen()
    await expect(view.terminal.step('Download', async () => 42, 'Source fetched')).resolves.toBe(42)
    await expect(view.terminal.step('Validate', async () => { throw new Error('Broken links') })).rejects.toThrow('Broken links')
    expect(view.output()).toContain('[ok] Source fetched')
    expect(view.output()).not.toContain('[ok] Validate')
    expect(view.errors()).toContain('[error] Validate: failed')
    expect(view.output()).not.toMatch(/[\x1b\r]/)
  })

  it('strips terminal control sequences while retaining useful diagnostic line breaks', () => {
    const hostile = '\x1b[2J\x1b[31mwarning\x1b[0m\x1b]8;;https://evil.test\x07link\x1b]8;;\x07\r\nsecond\x00'
    expect(terminalText(hostile)).toBe('warninglink\nsecond')
    const view = screen(true)
    view.terminal.warn(hostile)
    expect(view.errors()).not.toContain('evil.test')
    expect(view.errors()).not.toContain('\x1b[2J')
    expect(view.errors()).toContain('warninglink\nsecond')
  })

  it('keeps long destinations intact without fixed-width borders or truncation', () => {
    const view = screen()
    const destination = '/project with spaces/' + 'long-directory/'.repeat(15)
    view.terminal.detail('Output', destination)
    expect(view.output()).toContain(destination)
  })

  it('exposes verbose mode independently from color capability', () => {
    expect(screen(true, {}, ['--verbose']).terminal.isVerbose).toBe(true)
    expect(screen(false).terminal.isVerbose).toBe(false)
  })
})

describe('long-running step feedback', () => {
  it('reports changing activity and elapsed heartbeat in plain logs, then stops', async () => {
    const { vi } = await import('vitest')
    vi.useFakeTimers()
    try {
      const view = screen()
      let finish: () => void = () => {}
      const task = view.terminal.step('Discover source', (update) => {
        update('Fetch source repository')
        return new Promise<void>((resolve) => { finish = resolve })
      })
      await vi.advanceTimersByTimeAsync(15_000)
      expect(view.output()).toContain('Fetch source repository (15s elapsed)')
      finish()
      await task
      const complete = view.output()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(view.output()).toBe(complete)
    } finally { vi.useRealTimers() }
  })
})
