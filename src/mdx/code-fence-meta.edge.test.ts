/** Hostile-input tests for code-fence metadata and `[!code ...]` notation. */

import { describe, expect, it } from 'vitest'
import type { Element, Root } from 'hast'

import { codeInnerHtml } from './__tests__/test-html'
import { applyCodeNotation, parseCodeFenceMeta, rehypePlugins } from './rehype'

function codeBlock(value: string, language = 'txt'): Element {
  return {
    type: 'element',
    tagName: 'pre',
    properties: { language },
    children: [{ type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value }] }],
  }
}

async function render(value: string, language = 'typescript', props: Record<string, unknown> = {}) {
  const block = codeBlock(value, language)
  block.properties = { ...block.properties, ...props } as Element['properties']
  const transform = rehypePlugins[1]() as (tree: Root) => Promise<void>
  await transform({ type: 'root', children: [block] })
  const html = codeInnerHtml(block)
  return { code: block.properties?.code as string, html }
}

const linesOf = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')

async function renderProps(value: string, props: Record<string, unknown>) {
  const block = codeBlock(value, 'typescript')
  block.properties = { ...block.properties, ...props } as Element['properties']
  const transform = rehypePlugins[1]() as (tree: Root) => Promise<void>
  await transform({ type: 'root', children: [block] })
  return block.properties as Record<string, unknown>
}

const table: Array<[string, string, ReturnType<typeof parseCodeFenceMeta>]> = [
  // quoting and escapes
  ['escaped double quotes', 'title="He said \\"hi\\""', { title: 'He said "hi"' }],
  ['escaped single quotes', "title='it\\'s'", { title: "it's" }],
  ['backslash before closing quote is not eaten elsewhere', 'title="C:\\src\\app.ts"', { title: 'C:\\src\\app.ts' }],
  ['unterminated double quote', 'title="abc', { title: 'abc' }],
  ['unterminated group', '{1,3', { highlight: [1, 3] }],
  ['unterminated focus group', 'focus={2', { focus: [2] }],
  ['stray closing brace is ignored', '} app.ts', { title: 'app.ts' }],
  ['stray braces only', '{ }', { highlight: [] }],
  ['empty title falls back to bare words', 'title= Fallback', { title: 'Fallback' }],
  ['empty quoted title falls back', 'title="" Fallback', { title: 'Fallback' }],
  ['key without value', 'icon=', {}],
  ['value without key stays a word', '=value', { title: '=value' }],
  // whitespace and unicode
  ['tabs and repeated spaces collapse in titles', 'My\t\t  File   name', { title: 'My File name' }],
  ['NBSP separates words', 'My\u00a0File', { title: 'My File' }],
  ['emoji and CJK titles', '日本語 🚀 ファイル.ts', { title: '日本語 🚀 ファイル.ts' }],
  ['newline separates words', 'One\nTwo', { title: 'One Two' }],
  // duplicates and case
  ['duplicate title: last wins', 'title="a" title="b"', { title: 'b' }],
  ['title then filename: last wins', 'title="a" filename="b"', { title: 'b' }],
  ['duplicate highlight groups: last wins', '{1} {3}', { highlight: [3] }],
  ['duplicate flags are idempotent', 'lines lines wrap wrap', { lines: true, wrap: true }],
  ['flags are case-sensitive: Lines is a title word', 'Lines', { title: 'Lines' }],
  ['NOCOPY is a title word', 'NOCOPY', { title: 'NOCOPY' }],
  ['unknown key case (Title=) is ignored', 'Title="x"', {}],
  // flag-lookalike words (decision: bare lowercase flag words are flags anywhere)
  ['flag word inside a title is a flag', 'Show lines of code', { title: 'Show of code', lines: true }],
  ['quoted flag word stays in the title', '"Show lines"', { title: 'Show lines' }],
  ['quoted lone flag word is a title', '"lines"', { title: 'lines' }],
  ['title= plus bare words: explicit wins, words dropped', 'leftover words title="Real"', { title: 'Real' }],
  // groups
  ['group glued to filename', 'file.ts{1,2}', { title: 'file.ts', highlight: [1, 2] }],
  ['group glued to key-less word with spaces', 'file.ts{ 1 , 3-4 }', { title: 'file.ts', highlight: [1, 3, 4] }],
  ['JSON-ish theme with nested braces and quotes', 'theme={"light":"a}b","dark":{"x":"{"}} lines', { lines: true }],
  ['group after JSON theme', 'theme={"a":"b"} {2}', { highlight: [2] }],
  ['non-numeric group is ignored', '{a,b} app.ts', { title: 'app.ts' }],
  ['empty group', '{} app.ts', { title: 'app.ts' }],
  // titles with = and URLs
  ['unquoted URL value with =', 'title=https://x.y/a?b=c', { title: 'https://x.y/a?b=c' }],
  ['quoted URL with =', 'title="https://x.y/a?b=c"', { title: 'https://x.y/a?b=c' }],
  ['bare URL is one word', 'https://x.y/a?b=c', { title: 'https://x.y/a?b=c' }],
  ['filename with = via quotes', 'filename="a=b.ts"', { title: 'a=b.ts' }],
  // icon
  ['icon unknown name kept for the Icon component to resolve', 'icon="nope-icon"', { icon: 'nope-icon' }],
  ['icon URL kept verbatim', 'icon="https://x.y/i.svg"', { icon: 'https://x.y/i.svg' }],
  ['icon empty quotes ignored', 'icon=""', {}],
  ['icon braces', 'icon={"python"}', { icon: 'python' }],
  // ranges
  ['reversed range is empty', 'focus={5-2}', { focus: [] }],
  ['zero line is kept by the parser', '{0}', { highlight: [0] }],
  ['negative number ignored', '{-1}', { highlight: [] }],
  ['non-numeric focus ignored', 'focus={a-b}', {}],
  ['overlapping ranges are not deduped by the parser', '{1-3,2-4}', { highlight: [1, 2, 3, 2, 3, 4] }],
  ['huge single line number dropped', '{99999999999999999999}', { highlight: [] }],
  // booleans
  ['wrap={false}', 'wrap={false}', { wrap: false }],
  ['lines="true"', 'lines="true"', { lines: true }],
  ['twoslash flag is swallowed', 'twoslash app.ts', { title: 'app.ts' }],
  ['flags never leak as title', 'wrap lines expandable nocopy twoslash', { wrap: true, lines: true, expandable: true, nocopy: true }],
]

describe('parseCodeFenceMeta hostile inputs', () => {
  it.each(table)('%s', (_name, meta, expected) => {
    expect(parseCodeFenceMeta(meta)).toEqual(expected)
  })

  it('caps huge ranges', () => {
    expect(parseCodeFenceMeta('{1-4000000000}').highlight).toHaveLength(1_000)
  })
})

describe('parseCodeFenceMeta performance guard', () => {
  const cases: Array<[string, string]> = [
    ['10k-char word', 'a'.repeat(10_000)],
    ['10k unbalanced open braces', '{'.repeat(10_000)],
    ['10k nested balanced braces', '{'.repeat(5_000) + '}'.repeat(5_000)],
    ['10k quotes', '"'.repeat(10_000)],
    ['10k escaped quotes', 'title="' + '\\"'.repeat(5_000)],
    ['5k words', 'w '.repeat(5_000)],
    ['5k key=value pairs', 'k=v '.repeat(2_500)],
    ['5k glued groups', ('a{1}').repeat(2_500)],
    ['5k brace-digit runs', 'a{ 1 1 1'.repeat(1_000)],
    ['20k spaces', ' '.repeat(20_000) + 'x'],
  ]
  it.each(cases)('%s parses in under 50ms', (_name, meta) => {
    const start = performance.now()
    parseCodeFenceMeta(meta)
    expect(performance.now() - start).toBeLessThan(50)
  })
})

describe('applyCodeNotation edge cases', () => {
  it('leaves markers inside string literals alone unless they end the line as a comment', () => {
    expect(applyCodeNotation('const s = "// [!code ++]"')).toBeNull()
    expect(applyCodeNotation("const s = '# [!code --]'")).toBeNull()
  })

  it('handles a marker on the last line (no trailing newline)', () => {
    const r = applyCodeNotation('a\nb // [!code ++]')!
    expect(r.code).toBe('a\nb')
    expect([...r.marks.add]).toEqual([2])
  })

  it('removes a marker-only line and marks the FOLLOWING line (Shiki semantics)', () => {
    const r = applyCodeNotation('a\n  // [!code ++]\nb\nc')!
    expect(r.code).toBe('a\nb\nc')
    expect([...r.marks.add]).toEqual([2])
  })

  it('counts :N from the next line for marker-only lines, and from the same line otherwise', () => {
    expect([...applyCodeNotation('a\n# [!code --:2]\nb\nc\nd')!.marks.remove]).toEqual([2, 3])
    expect([...applyCodeNotation('a\nb // [!code --:2]\nc\nd')!.marks.remove]).toEqual([2, 3])
  })

  it('numbers marks by rendered lines when several marker-only lines precede', () => {
    const r = applyCodeNotation('// [!code focus]\na\n// [!code ++]\nb\nc')!
    expect(r.code).toBe('a\nb\nc')
    expect([...r.marks.focus]).toEqual([1])
    expect([...r.marks.add]).toEqual([2])
  })

  it('tolerates a marker-only last line (nothing to mark)', () => {
    const r = applyCodeNotation('a\n// [!code ++]')!
    expect(r.code).toBe('a')
  })

  it('recognises the JSX comment form', () => {
    const inline = applyCodeNotation('<b/> {/* [!code ++] */}')!
    expect(inline.code).toBe('<b/>')
    expect([...inline.marks.add]).toEqual([1])
    const only = applyCodeNotation('<a>\n  {/* [!code highlight] */}\n  <b/>\n</a>')!
    expect(only.code).toBe('<a>\n  <b/>\n</a>')
    expect([...only.marks.highlight]).toEqual([2])
    expect(applyCodeNotation('{ /*[!code --]*/ }')!.code).toBe('')
  })

  it('preserves CRLF endings', () => {
    const r = applyCodeNotation('a // [!code ++]\r\nb\r\n')!
    expect(r.code).toBe('a\r\nb\r\n')
    expect([...r.marks.add]).toEqual([1])
  })

  it.each([
    ['zero count is treated as 1', 'a // [!code ++:0]\nb', [1]],
    ['count past the end is harmless', 'a // [!code ++:5]\nb', [1, 2, 3, 4, 5]],
  ])('%s', (_name, code, add) => {
    expect([...applyCodeNotation(code)!.marks.add]).toEqual(add)
  })

  it('caps a huge count', () => {
    expect(applyCodeNotation('a // [!code ++:99999999999]')!.marks.add.size).toBe(1_000)
  })

  it('strips several markers stacked on one line', () => {
    const r = applyCodeNotation('a // [!code ++] // [!code focus]')!
    expect(r.code).toBe('a')
    expect([...r.marks.add]).toEqual([1])
    expect([...r.marks.focus]).toEqual([1])
  })

  it('leaves no trailing whitespace and preserves indentation', () => {
    expect(applyCodeNotation('    x = 1   \t // [!code highlight]')!.code).toBe('    x = 1')
  })

  it('leaves no comment-opener fragments', () => {
    expect(applyCodeNotation('<div/> <!-- [!code ++] -->')!.code).toBe('<div/>')
    expect(applyCodeNotation('x /* [!code --] */')!.code).toBe('x')
    expect(applyCodeNotation('x <!-- [!code ++]-->')!.code).toBe('x')
  })

  it('ignores unknown or malformed markers', () => {
    expect(applyCodeNotation('a // [!code nope]')).toBeNull()
    expect(applyCodeNotation('a // [!code ++')).toBeNull()
    expect(applyCodeNotation('a // note [!code nope] more')).toBeNull()
  })

  it('is linear on a long whitespace run (ReDoS guard)', () => {
    const line = 'x' + ' '.repeat(200_000) + '[!code ++] y'
    const start = performance.now()
    expect(applyCodeNotation(line)).toBeNull()
    const trailing = 'x // [!code ++]' + ' '.repeat(200_000) + 'y'
    expect(applyCodeNotation(trailing)!.code).toBe('x // y')
    expect(performance.now() - start).toBeLessThan(50)
  })

  it('is linear on many stacked markers (ReDoS guard)', () => {
    const stacked = 'x // ' + '[!code ++] '.repeat(20_000)
    const start = performance.now()
    expect(applyCodeNotation(stacked)!.code).toBe('x')
    expect(performance.now() - start).toBeLessThan(50)
  })

  it('stays fast with many markers on one line', () => {
    // Each marker's range is capped, and a repeated range is added once, so this is not markers x range.
    const ranges = 'x // ' + '[!code ++:999999] '.repeat(20_000)
    let start = performance.now()
    const r = applyCodeNotation(ranges)!
    expect(r.code).toBe('x')
    expect(r.marks.add.size).toBe(1_000)
    expect(performance.now() - start).toBeLessThan(100)
    // Every trailing marker is stripped in turn: the search for the next one must not rescan the whole line.
    const trailing = 'x ' + '// [!code ++] '.repeat(16_000)
    start = performance.now()
    expect(applyCodeNotation(trailing)!.code).toBe('x')
    expect(performance.now() - start).toBeLessThan(500)
  })
})

// Lines read from the migration guides of a site migrated from Mintlify, where Shiki strips the marker wherever it sits in a line comment.
describe('applyCodeNotation with a marker among comment text', () => {
  it('strips a marker that is followed by text, and keeps the text in the comment', () => {
    const r = applyCodeNotation([
      '      "price": 0.999738,   // [!code --] JSON number',
      '      "price": "0.999738"  // [!code ++] decimal string',
      '{ "price": 3.49076496006e-10 }          // [!code --] v1',
    ].join('\n'))!
    expect(r.code).toBe([
      '      "price": 0.999738,   // JSON number',
      '      "price": "0.999738"  // decimal string',
      '{ "price": 3.49076496006e-10 }          // v1',
    ].join('\n'))
    expect([...r.marks.remove]).toEqual([1, 3])
    expect([...r.marks.add]).toEqual([2])
  })

  it('strips a marker that comes after the comment text', () => {
    const r = applyCodeNotation('    x-api-key: <your-api-key>        # now required [!code ++]\n    next')!
    expect(r.code).toBe('    x-api-key: <your-api-key>        # now required\n    next')
    expect([...r.marks.add]).toEqual([1])
    const mid = applyCodeNotation('a // one [!code ++] two')!
    expect(mid.code).toBe('a // one two')
    expect([...mid.marks.add]).toEqual([1])
  })

  it('keeps a comment-only line with text, and marks the line below it instead', () => {
    const r = applyCodeNotation([
      '    "currency": "usdc", // [!code --]',
      '    "currencyObject": { "chainId": 137 } // [!code --]',
      '    // read the currency object directly off the amount, [!code ++]',
      '    // e.g. data.route.actual.origin.inputCurrency.currency [!code ++]',
    ].join('\n'))!
    expect(r.code).toBe([
      '    "currency": "usdc",',
      '    "currencyObject": { "chainId": 137 }',
      '    // read the currency object directly off the amount,',
      '    // e.g. data.route.actual.origin.inputCurrency.currency',
    ].join('\n'))
    expect([...r.marks.remove]).toEqual([1, 2])
    // Only the second comment line is marked: the first line's marker applies to the line below it (the second's falls past the last line).
    expect([...r.marks.add].filter((line) => line <= 4)).toEqual([4])
  })

  it('counts :N from the line below a comment-only line with text, and from the same line otherwise', () => {
    expect([...applyCodeNotation('a\n# note [!code --:2]\nb\nc\nd')!.marks.remove]).toEqual([3, 4])
    expect([...applyCodeNotation('a\nb // note [!code --:2]\nc\nd')!.marks.remove]).toEqual([2, 3])
  })

  it('numbers marks by rendered lines after a marker-only line is removed', () => {
    const r = applyCodeNotation('a\n// [!code focus]\nb // note [!code ++]\nc')!
    expect(r.code).toBe('a\nb // note\nc')
    expect([...r.marks.focus]).toEqual([2])
    expect([...r.marks.add]).toEqual([2])
  })

  it('reads every comment opener the notation supports', () => {
    const r = applyCodeNotation([
      'SELECT 1 -- old [!code --]',
      '<b/> <!-- new [!code ++] more -->',
      'c /* a [!code focus] b */',
      '<a/> {/* note [!code highlight] */}',
    ].join('\n'))!
    expect(r.code).toBe(['SELECT 1 -- old', '<b/> <!-- new more -->', 'c /* a b */', '<a/> {/* note */}'].join('\n'))
    expect([...r.marks.remove]).toEqual([1])
    expect([...r.marks.add]).toEqual([2])
    expect([...r.marks.focus]).toEqual([3])
    expect([...r.marks.highlight]).toEqual([4])
    const only = applyCodeNotation('<a>\n  {/* note [!code highlight] */}\n  <b/>\n</a>')!
    expect(only.code).toBe('<a>\n  {/* note */}\n  <b/>\n</a>')
    expect([...only.marks.highlight]).toEqual([3])
  })

  it('skips a comment opener inside a string, and keeps a marker inside a string', () => {
    const url = applyCodeNotation('    "url": "https://api.test/a#b",  // note [!code ++]')!
    expect(url.code).toBe('    "url": "https://api.test/a#b",  // note')
    expect(applyCodeNotation('const s = "see // [!code ++] here"')).toBeNull()
    expect(applyCodeNotation("const s = 'a # b [!code --] c'")).toBeNull()
    expect(applyCodeNotation('const s = `x -- [!code ++] y`')).toBeNull()
    expect([...applyCodeNotation('const s = "// [!code ++]" // note [!code --]')!.marks.remove]).toEqual([1])
  })

  it('keeps a quote that escapes inside a string', () => {
    expect(applyCodeNotation('const s = "a \\" // [!code ++] b"')).toBeNull()
  })

  it('reads the comment that holds the marker, not a `#` or `--` that is code', () => {
    const curl = applyCodeNotation("curl https://x \\\n  --header 'a' # old [!code --]\n  --data x")!
    expect(curl.code).toBe("curl https://x \\\n  --header 'a' # old\n  --data x")
    expect([...curl.marks.remove]).toEqual([2])
    const include = applyCodeNotation('#include <stdio.h> // old [!code --]\nint main() {}')!
    expect(include.code).toBe('#include <stdio.h> // old\nint main() {}')
    expect([...include.marks.remove]).toEqual([1])
    const css = applyCodeNotation('#main { color: red } /* new [!code ++] */\nnext')!
    expect(css.code).toBe('#main { color: red } /* new */\nnext')
    expect([...css.marks.add]).toEqual([1])
    const flag = applyCodeNotation('--verbose  // note [!code ++]\nnext')!
    expect([...flag.marks.add]).toEqual([1])
    const shebang = applyCodeNotation('#!/bin/bash # note [!code ++]\nnext')!
    expect([...shebang.marks.add]).toEqual([1])
    const npm = applyCodeNotation('npm i \\\n  --save-dev x # new [!code ++]\nnext')!
    expect([...npm.marks.add]).toEqual([2])
  })

  it('does not read a `#` or `--` inside comment text as the start of the comment', () => {
    // A comment-only line stays unmarked and marks the line below, as before.
    const issue = applyCodeNotation('// see issue #12 [!code ++]\nnext')!
    expect(issue.code).toBe('// see issue #12\nnext')
    expect([...issue.marks.add]).toEqual([2])
    const flag = applyCodeNotation('# run with --verbose [!code ++]\nnext')!
    expect([...flag.marks.add]).toEqual([2])
  })

  it('keeps a comment that holds an apostrophe or a quote', () => {
    const r = applyCodeNotation("x = 1 // it's [!code ++]\ny // \"quoted\" [!code --]")!
    expect(r.code).toBe("x = 1 // it's\ny // \"quoted\"")
    expect([...r.marks.add]).toEqual([1])
    expect([...r.marks.remove]).toEqual([2])
  })

  it('preserves CRLF endings', () => {
    const r = applyCodeNotation('a // [!code ++] text\r\nb // text [!code --]\r\nc')!
    expect(r.code).toBe('a // text\r\nb // text\r\nc')
    expect([...r.marks.add]).toEqual([1])
    expect([...r.marks.remove]).toEqual([2])
  })
})

describe('rehypeShiki notation integration', () => {
  it('combines highlight, focus, add and remove on different lines', async () => {
    const { code, html } = await render(
      'a // [!code ++]\nb // [!code --]\nc // [!code highlight]\nd // [!code focus]\ne',
      'typescript',
      { highlightLines: '5' },
    )
    expect(code).toBe('a\nb\nc\nd\ne')
    const spans = html.split('\n')
    expect(spans[0]).toContain('thally-line-add')
    expect(spans[1]).toContain('thally-line-remove')
    expect(spans[2]).toContain('thally-line-highlight')
    expect(spans[3]).not.toContain('thally-line-dim')
    expect(spans[4]).toContain('thally-line-highlight')
    expect(spans[4]).toContain('thally-line-dim')
  })

  it('does not dim anything when focus targets nonexistent lines', async () => {
    for (const focusLines of ['0', '99', '0,99']) {
      const { html } = await render('a\nb', 'typescript', { focusLines })
      expect(html).not.toContain('thally-line-dim')
    }
  })

  it('marks and cleans the lines of a diff fence that carry comment text', async () => {
    const { code, html } = await render([
      '{',
      '  "price": 0.999738,   // [!code --] JSON number',
      '  "price": "0.999738"  // [!code ++] decimal string',
      '  // read it directly, [!code ++]',
      '  "unit": "usd"',
      '}',
    ].join('\n'), 'jsonc')
    expect(code).not.toContain('[!code')
    expect(code).toContain('// JSON number')
    const spans = html.split('\n')
    expect(spans[1]).toContain('thally-line-remove')
    expect(spans[2]).toContain('thally-line-add')
    expect(spans[3]).not.toContain('thally-line-add')
    expect(spans[4]).toContain('thally-line-add')
    expect(html).not.toContain('[!code')
  })

  it('meta line numbers refer to rendered lines, after marker-only lines are removed', async () => {
    const { html } = await render('a\n// [!code ++]\nb\nc', 'typescript', { highlightLines: '3' })
    const spans = html.split('\n')
    expect(spans).toHaveLength(3)
    expect(spans[1]).toContain('thally-line-add')
    expect(spans[2]).toContain('thally-line-highlight')
  })

  it('lifts lastmarked only for expandable fences', async () => {
    const source = linesOf(15)
    const marked = source.replace('line 12', 'line 12 // [!code ++]')
    const plain = await renderProps(marked, {})
    expect(plain.lastmarked).toBeUndefined()
    const exp = await renderProps(marked, { expandable: '' })
    expect(exp.lastmarked).toBe('13')
    const none = await renderProps(source, { expandable: '' })
    expect(none.lastmarked).toBeUndefined()
  })

  it('strips markers for a language Shiki falls back on', async () => {
    const { code, html } = await render('a // [!code ++]', 'not-a-real-language')
    expect(code).toBe('a')
    expect(html).not.toContain('[!code')
  })

  it('handles CRLF fences', async () => {
    const { code } = await render('a // [!code ++]\r\nb', 'typescript')
    expect(code).toBe('a\r\nb')
  })

  it('renders a 2,000-line marked block quickly', async () => {
    const source = Array.from({ length: 2_000 }, (_, i) => `const v${i} = ${i}${i % 10 === 0 ? ' // [!code ++]' : ''}`).join('\n')
    const start = performance.now()
    const { html } = await render(source, 'typescript')
    expect(html.split('\n')).toHaveLength(2_000)
    expect(performance.now() - start).toBeLessThan(5_000)
  })
})
