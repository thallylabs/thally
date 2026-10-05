/** Rich setup prompts preserve source-selection, validation, and cancellation contracts. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  terminal: { isRich: false },
  releaseAccent: vi.fn(),
  rich: { text: vi.fn(), select: vi.fn(), confirm: vi.fn(), isCancel: (value: unknown) => typeof value === 'symbol' },
  plain: { input: vi.fn(), select: vi.fn(), confirm: vi.fn() },
}))
vi.mock('../terminal.js', () => ({ terminal: mocks.terminal, acquireTerminalAccent: () => mocks.releaseAccent }))
vi.mock('@clack/prompts', () => mocks.rich)
vi.mock('@inquirer/prompts', () => mocks.plain)

import { confirm, input, select } from '../interactive-prompts.js'

describe('setup prompt adapter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.terminal.isRich = true
  })

  it('retains the Inquirer fallback and original options in plain terminals', async () => {
    mocks.terminal.isRich = false
    mocks.plain.input.mockResolvedValue('name')
    mocks.plain.select.mockResolvedValue(undefined)
    mocks.plain.confirm.mockResolvedValue(false)
    const textOptions = { message: ' Name:', default: 'Docs' }
    const selectOptions = { message: 'Source?', choices: [{ name: 'Auto', value: undefined }] }
    const confirmOptions = { message: 'Continue?', default: false }
    expect(await input(textOptions)).toBe('name')
    expect(await select(selectOptions)).toBeUndefined()
    expect(await confirm(confirmOptions)).toBe(false)
    expect(mocks.plain.input).toHaveBeenCalledWith(textOptions)
    expect(mocks.plain.select).toHaveBeenCalledWith(selectOptions)
    expect(mocks.plain.confirm).toHaveBeenCalledWith(confirmOptions)
    expect(mocks.rich.text).not.toHaveBeenCalled()
  })

  it('converts text defaults and validation without accepting invalid sources', async () => {
    mocks.rich.text.mockResolvedValue('https://github.com/acme/docs')
    await input({ message: '  Repository:', default: '', validate: (value) => {
      try {
        const url = new URL(value)
        return url.protocol === 'https:' && url.hostname === 'github.com' ? true : 'Use GitHub'
      } catch {
        return 'Use GitHub'
      }
    } })
    const options = mocks.rich.text.mock.calls[0][0]
    expect(options.initialValue).toBe('')
    expect(options.defaultValue).toBe('')
    expect(options.message).toBe('Repository:')
    expect(options.validate('https://github.com/acme/docs')).toBeUndefined()
    expect(options.validate('https://example.com')).toBe('Use GitHub')
    for (const source of [
      'https://github.com.evil.test/docs', 'https://evil.test/github.com',
      'https://github.com@evil.test/docs', 'http://github.com/acme/docs', 'not a URL',
    ]) expect(options.validate(source)).toBe('Use GitHub')
  })

  it('keeps automatic detection as an undefined answer and confirm opt-in false', async () => {
    mocks.rich.select.mockResolvedValue(undefined)
    mocks.rich.confirm.mockResolvedValue(false)
    expect(await select({ message: 'Platform?', default: 'mintlify', choices: [
      { name: 'Mintlify', value: 'mintlify' }, { name: 'Detect automatically', value: undefined },
    ] })).toBeUndefined()
    expect(mocks.rich.select).toHaveBeenCalledWith({ message: 'Platform?', initialValue: 'mintlify', options: [
      { label: 'Mintlify', value: 'mintlify' }, { label: 'Detect automatically', value: undefined },
    ] })
    expect(await confirm({ message: 'Proceed?', default: false })).toBe(false)
    expect(mocks.rich.confirm).toHaveBeenCalledWith({ message: 'Proceed?', initialValue: false })
  })

  it.each(['input', 'select', 'confirm'] as const)('turns cancelled %s prompts into exit code 130', async (kind) => {
    const cancelled = Symbol('cancelled')
    mocks.rich.text.mockResolvedValue(cancelled)
    mocks.rich.select.mockResolvedValue(cancelled)
    mocks.rich.confirm.mockResolvedValue(cancelled)
    const answer = kind === 'input' ? input({ message: 'Name?' })
      : kind === 'select' ? select({ message: 'Source?', choices: [{ name: 'Auto', value: undefined }] })
      : confirm({ message: 'Proceed?', default: false })
    await expect(answer).rejects.toMatchObject({ message: 'Cancelled.', exitCode: 130 })
    expect(mocks.releaseAccent).toHaveBeenCalledOnce()
  })

  it('releases the accent when a prompt fails', async () => {
    mocks.rich.text.mockRejectedValue(new Error('Prompt failed'))
    await expect(input({ message: 'Name?' })).rejects.toThrow('Prompt failed')
    expect(mocks.releaseAccent).toHaveBeenCalledOnce()
  })
})
