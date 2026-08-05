/** Regression tests for code-fence metadata shared by authored and migrated docs. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { Element, Root, Text } from 'hast'

import {
  measureHighlightableCode,
  parseCodeFenceMeta,
  rehypePlugins,
  scheduleSyntaxHighlight,
  type SyntaxHighlightBudget,
} from './rehype'

function codeBlock(value: string): Element {
  return {
    type: 'element',
    tagName: 'pre',
    properties: { language: 'txt' },
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: {},
        children: [{ type: 'text', value }],
      },
    ],
  }
}

async function transformCodeBlocks(blocks: Array<Element>): Promise<void> {
  const transform = rehypePlugins[1]() as (tree: Root) => Promise<void>
  await transform({ type: 'root', children: blocks })
}

function codeText(block: Element): Text {
  return ((block.children[0] as Element).children[0] as Text)
}

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
    expect(source).toContain("from 'shiki/langs/typescript.mjs'")
    expect(source).not.toContain("from '@shikijs/langs/")
    expect(source).not.toContain('createHighlighter,')
    expect(source).not.toContain('.loadLanguage(')
    expect(source).toContain('MAX_HIGHLIGHTED_CODE_BLOCK_BYTES')
    expect(source).toContain('MAX_HIGHLIGHTED_PAGE_BYTES')
    expect(source).toContain('measureHighlightableCode(code)')
  })

  it('bounds authored highlight ranges before allocating them', () => {
    const parsed = parseCodeFenceMeta('{1-4000000000}')
    expect(parsed.highlight).toHaveLength(1_000)
    expect(parsed.highlight?.at(-1)).toBe(1_000)
  })

  it('keeps oversized or exceptionally tall fences out of syntax highlighting', () => {
    expect(measureHighlightableCode('a'.repeat(64 * 1024))).toBe(64 * 1024)
    expect(measureHighlightableCode('a'.repeat(64 * 1024 + 1))).toBeNull()
    expect(measureHighlightableCode('😀'.repeat(20_000))).toBeNull()
    expect(measureHighlightableCode('line\n'.repeat(2_000))).toBeNull()
  })

  it('stops measuring fences after the aggregate page budget is exhausted', () => {
    const budget: SyntaxHighlightBudget = {
      scheduledBlocks: 0,
      scheduledBytes: 0,
      isExhausted: false,
    }
    for (let block = 0; block < 4; block += 1) {
      expect(scheduleSyntaxHighlight('a'.repeat(64 * 1024), budget)).toBe(true)
    }
    expect(budget.isExhausted).toBe(true)
    expect(scheduleSyntaxHighlight('later fence', budget)).toBe(false)
    expect(budget).toMatchObject({ scheduledBlocks: 4, scheduledBytes: 256 * 1024 })
  })

  it('escapes oversized plaintext before it reaches grouped code HTML rendering', async () => {
    const payload = '<img src=x onerror=alert(1)>' + 'a'.repeat(64 * 1024)
    const block = codeBlock(payload)
    await transformCodeBlocks([block])
    expect(codeText(block).value).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(codeText(block).value).not.toContain('<img')
  })

  it('escapes fences beyond the per-page block budget', async () => {
    const blocks = Array.from({ length: 64 }, () => codeBlock('const ok = true'))
    const overflow = codeBlock('<img src=x onerror=alert(1)>')
    await transformCodeBlocks([...blocks, overflow])
    expect(codeText(overflow).value).toBe('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('ignores reversed and wholly out-of-bounds highlight ranges', () => {
    expect(parseCodeFenceMeta('{5-2}').highlight).toEqual([])
    expect(parseCodeFenceMeta('{100001-100002}').highlight).toEqual([])
  })
})
