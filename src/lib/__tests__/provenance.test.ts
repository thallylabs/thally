import { describe, it, expect } from 'vitest'
import { stripInternalFrontmatter, INTERNAL_FRONTMATTER_KEYS } from '@/lib/provenance'

describe('stripInternalFrontmatter', () => {
  it('removes internal provenance keys but keeps public frontmatter + body', () => {
    const raw = [
      '---',
      'title: Authentication',
      'description: How to auth',
      'lastVerified: 2026-07-01',
      'sources:',
      '  - src/auth/token.ts',
      '  - widget:openapi.yaml#/paths/~1login',
      'verifiedCommit: abc1234def',
      '---',
      '',
      'Body content stays.',
    ].join('\n')

    const out = stripInternalFrontmatter(raw)

    // Public frontmatter + body preserved
    expect(out).toContain('title: Authentication')
    expect(out).toContain('lastVerified')
    expect(out).toContain('Body content stays.')

    // Internal keys and their values gone — the leak the .md mirror could ship
    expect(out).not.toContain('sources')
    expect(out).not.toContain('verifiedCommit')
    expect(out).not.toContain('abc1234def')
    expect(out).not.toContain('src/auth/token.ts')
    expect(out).not.toContain('openapi.yaml')
  })

  it('returns the input untouched when there are no internal keys', () => {
    const raw = ['---', 'title: Clean', '---', '', 'Body.'].join('\n')
    expect(stripInternalFrontmatter(raw)).toBe(raw)
  })

  it('handles content with no frontmatter', () => {
    const raw = 'Just a body, no frontmatter.'
    expect(stripInternalFrontmatter(raw)).toBe(raw)
  })

  it('declares sources and verifiedCommit as internal', () => {
    expect(INTERNAL_FRONTMATTER_KEYS).toContain('sources')
    expect(INTERNAL_FRONTMATTER_KEYS).toContain('verifiedCommit')
  })
})
