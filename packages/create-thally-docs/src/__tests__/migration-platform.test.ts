/** Scriptable source-platform validation for the interactive migration flow. */

import { describe, expect, it } from 'vitest'

import { parseMigrationPlatform } from '../prompts.js'

describe('migration platform selection', () => {
  it('accepts Mintlify, Docusaurus, and explicit auto-detection', () => {
    expect(parseMigrationPlatform('mintlify')).toBe('mintlify')
    expect(parseMigrationPlatform('docusaurus')).toBe('docusaurus')
    expect(parseMigrationPlatform('auto')).toBeUndefined()
    expect(parseMigrationPlatform(undefined)).toBeUndefined()
  })

  it('rejects unsupported platform flags before discovery starts', () => {
    expect(() => parseMigrationPlatform('wordpress')).toThrow(
      '--platform must be mintlify, docusaurus, or auto.',
    )
  })
})
