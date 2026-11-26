/** Exact source merging: ambiguity or exhausted work always requires review. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isStarterSourceMergePath, mergeStarterSourceContents,
  STARTER_SOURCE_MERGE_LIMITS as limits,
} from '../starter-source-merge.js'

const merge = (base: string, local: string, upstream: string) =>
  mergeStarterSourceContents('src/data/docs.ts', Buffer.from(base), Buffer.from(local), Buffer.from(upstream))

afterEach(() => vi.restoreAllMocks())

describe('exact source three-way merge', () => {
  it('combines disjoint edits and deduplicates identical shared edits', () => {
    expect(merge('a\nb\nc\nd\ne\n', 'A\nb\nc\nd\nE\n', 'a\nb\nC\nd\nE\n'))
      .toBe('A\nb\nC\nd\nE\n')
    expect(merge('a\nb\nc\n', 'a\nadded\nb\nc\n', 'a\nadded\nb\nC\n'))
      .toBe('a\nadded\nb\nC\n')
  })

  it('merges independent deletion and insertion without losing order', () => {
    expect(merge('a\nb\nc\nd\n', 'a\nc\nd\n', 'a\nb\nc\nd\ne\n'))
      .toBe('a\nc\nd\ne\n')
  })

  it.each([
    ['a\nb\nc\n', 'a\nB\nc\n', 'a\nother\nc\n'],
    ['a\nb\nc\n', 'a\nc\n', 'a\nB\nc\n'],
    ['a\nb\n', 'a\nlocal\nb\n', 'a\nupstream\nb\n'],
    // Even insertion at a changed range's boundary leaves ordering ambiguous.
    ['a\nb\nc\n', 'a\nlocal\nb\nc\n', 'a\nB\nc\n'],
  ])('refuses overlapping edits and competing insertion points', (base, local, upstream) => {
    expect(merge(base, local, upstream)).toBeUndefined()
  })

  it('keeps exact whitespace, local CRLF, Unicode and final-newline edits', () => {
    expect(merge('a\nb\nc\n', 'a  \r\nb\r\nc\r\n', 'a\nb\n日本語\n'))
      .toBe('a  \r\nb\r\n日本語\r\n')
    expect(merge('a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nc')).toBe('A\nb\nc')
    expect(merge('a\nb\nc', 'A\nb\nc', 'a\nb\nC')).toBe('A\nb\nC')
    expect(merge('a\nb\n', 'a\r\nb\n', 'a\nB\n')).toBeUndefined()
    expect(merge('a\nb\n', 'a\rb\n', 'a\nB\n')).toBeUndefined()
  })

  it.each([
    'starter-release.json', 'starter-release.ts', '.thally/source.ts',
    'src/generated/dates.ts', 'src/__generated__/dates.ts', 'src/dates.json',
    'src/dates.jsonc', '.env.ts', 'src/.env/local.ts', 'src/lib/agent-identity.ts',
    'src/lib/provenance/runtime.ts', 'src/content/intro.mdx', 'snippets/code.ts',
    'public/code.js', 'src/data/site.ts', 'src/mdx/custom-components.tsx',
    'next.config.ts', '../outside.ts', '/outside.ts', 'src\\escape.ts',
  ])('never opts reserved/owner/non-source path %s into a merge', path => {
    expect(isStarterSourceMergePath(path)).toBe(false)
    expect(mergeStarterSourceContents(path, Buffer.from('a\nb\nc\n'), Buffer.from('A\nb\nc\n'), Buffer.from('a\nb\nC\n'))).toBeUndefined()
  })

  it('rejects binary, malformed UTF-8, oversize inputs and excessive lines', () => {
    for (const bad of [Buffer.from([0x61, 0, 0x62]), Buffer.from([0xc3, 0x28]), Buffer.alloc(limits.bytes + 1, 0x61), Buffer.from('x\n'.repeat(limits.lines + 1))]) {
      expect(mergeStarterSourceContents('src/lib/a.ts', Buffer.from('a\n'), bad, Buffer.from('b\n'))).toBeUndefined()
    }
  })

  it('fails closed at edit-distance, hunk and elapsed-time bounds', () => {
    const base = Array.from({ length: 1_100 }, (_, i) => `old${i}\n`).join('')
    const local = Array.from({ length: 1_100 }, (_, i) => `new${i}\n`).join('')
    expect(merge(base, local, `${base}tail\n`)).toBeUndefined()
    const rows = Array.from({ length: 1_600 }, (_, i) => `row${i}\n`)
    expect(merge(rows.join(''), rows.map((row, i) => i % 3 === 0 ? `local${i}\n` : row).join(''), `${rows.join('')}tail\n`)).toBeUndefined()
    let time = 0
    vi.spyOn(Date, 'now').mockImplementation(() => time += limits.milliseconds + 1)
    expect(merge('a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n')).toBeUndefined()
  })
})
