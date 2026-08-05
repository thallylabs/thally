/** Regression tests for code-fence metadata shared by authored and migrated docs. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseCodeFenceMeta } from './rehype'

describe('code-fence metadata', () => {
  it('does not display renderer presentation props as code titles', () => {
    expect(parseCodeFenceMeta('theme={"system"}')).toEqual({})
    expect(parseCodeFenceMeta('api-client.ts theme={"system"}')).toEqual({ title: 'api-client.ts' })
  })

  it('keeps explicit filenames and portable display options', () => {
    expect(parseCodeFenceMeta('filename="client.ts" wrap {2,4-5}')).toEqual({
      title: 'client.ts',
      wrap: true,
      highlight: [2, 4, 5],
    })
  })

  it('keeps syntax grammars fine-grained for managed Worker bundles', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./rehype.ts', import.meta.url)),
      'utf8',
    )
    expect(source).toContain("from 'shiki/core'")
    expect(source).toContain("from '@shikijs/langs/typescript'")
    expect(source).not.toContain('createHighlighter,')
    expect(source).not.toContain('.loadLanguage(')
  })

  it('bounds authored highlight ranges before allocating them', () => {
    const parsed = parseCodeFenceMeta('{1-4000000000}')
    expect(parsed.highlight).toHaveLength(1_000)
    expect(parsed.highlight?.at(-1)).toBe(1_000)
  })

  it('ignores reversed and wholly out-of-bounds highlight ranges', () => {
    expect(parseCodeFenceMeta('{5-2}').highlight).toEqual([])
    expect(parseCodeFenceMeta('{100001-100002}').highlight).toEqual([])
  })
})
