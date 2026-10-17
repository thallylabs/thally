/**
 * Guards the interactive fallback from repository-aware migration to a less
 * complete crawl of a rendered documentation website.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const promptMocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}))

vi.mock('@inquirer/prompts', () => promptMocks)

import {
  LIVE_URL_MIGRATION_WARNING,
  resolveAutoDetectedMigrationSource,
} from '../prompts.js'

describe('auto-detected live-site migration guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('leaves GitHub repository sources unchanged without prompting', async () => {
    const sourceUrl = 'https://github.com/acme/docs'

    await expect(resolveAutoDetectedMigrationSource(sourceUrl, true)).resolves.toBe(sourceUrl)
    expect(promptMocks.select).not.toHaveBeenCalled()
    expect(promptMocks.confirm).not.toHaveBeenCalled()
  })

  it('leaves GitLab repository sources, including nested groups, unchanged', async () => {
    const sourceUrl = 'https://gitlab.com/acme/platform/docs/-/tree/main/content'

    await expect(resolveAutoDetectedMigrationSource(sourceUrl, true)).resolves.toBe(sourceUrl)
    expect(promptMocks.select).not.toHaveBeenCalled()
  })

  it('accepts a GitLab repository in place of a live URL', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    promptMocks.select.mockResolvedValue('repository')
    promptMocks.input.mockResolvedValue('https://gitlab.com/acme/docs')

    await expect(resolveAutoDetectedMigrationSource('https://docs.acme.com', true)).resolves.toBe(
      'https://gitlab.com/acme/docs',
    )
    const { validate } = promptMocks.input.mock.calls[0][0] as { validate: (value: string) => true | string }
    expect(validate('https://gitlab.com/acme/platform/docs')).toBe(true)
    expect(validate('https://docs.acme.com')).toMatch(/github\.com, gitlab\.com/)
  })

  it('lets an interactive user replace a live URL with its source repository', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    promptMocks.select.mockResolvedValue('repository')
    promptMocks.input.mockResolvedValue('https://github.com/acme/docs')

    await expect(
      resolveAutoDetectedMigrationSource('https://docs.acme.com', true),
    ).resolves.toBe('https://github.com/acme/docs')
    expect(promptMocks.input).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Repository URL (GitHub or GitLab)'),
        validate: expect.any(Function),
      }),
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(LIVE_URL_MIGRATION_WARNING))
  })

  it('requires explicit acceptance before crawling the live website', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    promptMocks.select.mockResolvedValue('website')
    promptMocks.confirm.mockResolvedValue(true)

    await expect(
      resolveAutoDetectedMigrationSource('https://docs.acme.com', true),
    ).resolves.toBe('https://docs.acme.com')
    expect(promptMocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/manual alignment.*Thally MCP/),
        default: false,
      }),
    )
  })

  it('cancels when the live-site limitation is declined', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    promptMocks.select.mockResolvedValue('website')
    promptMocks.confirm.mockResolvedValue(false)

    await expect(
      resolveAutoDetectedMigrationSource('https://docs.acme.com', true),
    ).rejects.toThrow('Migration cancelled')
  })

  it('warns without prompting during an acknowledged automated run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(
      resolveAutoDetectedMigrationSource('https://docs.acme.com', false),
    ).resolves.toBe('https://docs.acme.com')
    expect(promptMocks.select).not.toHaveBeenCalled()
    expect(promptMocks.confirm).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('source repository (GitHub or GitLab)'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Thally MCP'))
  })
})
