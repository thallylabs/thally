/** Scriptable source-platform validation for the interactive migration flow. */

import { afterEach, describe, expect, it } from 'vitest'

import { gatherMigrationPlatform, parseMigrationPlatform } from '../prompts.js'

describe('migration platform selection', () => {
  it('accepts Mintlify, Docusaurus, Fern, and explicit auto-detection', () => {
    expect(parseMigrationPlatform('mintlify')).toBe('mintlify')
    expect(parseMigrationPlatform('docusaurus')).toBe('docusaurus')
    expect(parseMigrationPlatform('fern')).toBe('fern')
    expect(parseMigrationPlatform('auto')).toBeUndefined()
    expect(parseMigrationPlatform(undefined)).toBeUndefined()
  })

  it('rejects unsupported platform flags before discovery starts', () => {
    expect(() => parseMigrationPlatform('wordpress')).toThrow(
      '--platform must be mintlify, docusaurus, fern, or auto.',
    )
  })
})

describe('gatherMigrationPlatform on a non-TTY stdin', () => {
  const originalIsTTY = process.stdin.isTTY

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY
  })

  it('falls back to auto-detection instead of blocking on an interactive select', async () => {
    process.stdin.isTTY = false

    // No --platform, and -y (useDefaults) wasn't passed either — this is
    // exactly the case that used to call @inquirer/prompts' select() and
    // hang forever with nothing to read from stdin.
    await expect(gatherMigrationPlatform(undefined, false)).resolves.toBeUndefined()
  })

  it('still honors an explicit --platform without needing a TTY', async () => {
    process.stdin.isTTY = false
    await expect(gatherMigrationPlatform('fern', false)).resolves.toBe('fern')
  })
})
