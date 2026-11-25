/** Title strings read inline code the way Mintlify renders it: the text between backticks is code, the backticks are markup. */

import { describe, expect, it } from 'vitest'
import { inlineCodeParts, linkedTitleLinks, linkedTitleParts, plainInlineText, plainLinkedTitle } from '@thallylabs/core/slugify'

describe('inlineCodeParts', () => {
  it('splits a title into text and code runs in order', () => {
    expect(inlineCodeParts('Don\'t use this in parallel, e.g. with `Promise.all()`')).toEqual([
      { text: 'Don\'t use this in parallel, e.g. with ', code: false },
      { text: 'Promise.all()', code: true },
    ])
    expect(inlineCodeParts('Run the CLI `init` command')).toEqual([
      { text: 'Run the CLI ', code: false },
      { text: 'init', code: true },
      { text: ' command', code: false },
    ])
  })

  it('returns a title without code as one text run, and nothing for an empty title', () => {
    expect(inlineCodeParts('Create a project')).toEqual([{ text: 'Create a project', code: false }])
    expect(inlineCodeParts('')).toEqual([])
  })

  it('leaves an unpaired backtick and an empty pair as text', () => {
    expect(inlineCodeParts('Use the ` key')).toEqual([{ text: 'Use the ` key', code: false }])
    expect(inlineCodeParts('Empty `` pair')).toEqual([{ text: 'Empty `` pair', code: false }])
  })

  it('keeps other Markdown characters as text', () => {
    expect(inlineCodeParts('**bold** and `x`')).toEqual([
      { text: '**bold** and ', code: false },
      { text: 'x', code: true },
    ])
  })
})

describe('plainInlineText', () => {
  it.each([
    ['Run the CLI `init` command', 'Run the CLI init command'],
    ['Create an `actions.ts` file', 'Create an actions.ts file'],
    ['Create a project', 'Create a project'],
    ['Use the ` key', 'Use the ` key'],
  ])('reads %s as %s', (input, expected) => {
    expect(plainInlineText(input)).toBe(expected)
  })
})

describe('linkedTitleParts', () => {
  it('splits a title into text, code and link parts in order', () => {
    expect(linkedTitleParts('Install the [Thally CLI](/cli/overview) with `npm`')).toEqual([
      { text: 'Install the ', code: false },
      { href: '/cli/overview', parts: [{ text: 'Thally CLI', code: false }] },
      { text: ' with ', code: false },
      { text: 'npm', code: true },
    ])
  })

  it('keeps a code span inside a link label as code', () => {
    expect(linkedTitleParts('Run [`thally check`](/cli/check)')).toEqual([
      { text: 'Run ', code: false },
      { href: '/cli/check', parts: [{ text: 'thally check', code: true }] },
    ])
  })

  it.each([
    'Run the CLI `init` command',
    '`a`b',
    '`one` and `two`',
    'Use the ` key',
    'Empty `` pair',
    '**bold** and `x`',
    'Create a project',
    'Array[0] and (parens)',
    '',
  ])('reads the title %j with no link exactly as inlineCodeParts does', (title) => {
    expect(linkedTitleParts(title)).toEqual(inlineCodeParts(title))
    expect(plainLinkedTitle(title)).toBe(plainInlineText(title))
    expect(linkedTitleLinks(title)).toEqual([])
  })

  it('reads a link written inside a code span as code', () => {
    expect(linkedTitleParts('`[not a link](/x)`')).toEqual([{ text: '[not a link](/x)', code: true }])
  })

  it.each([
    '![image](/logo.png)',
    '\\[escaped](/x)',
    '[script](javascript:alert)',
    '[data](data:text/html,x)',
    '[ ](/blank)',
    '[spaced](/a b)',
  ])('leaves %j as the text the author typed', (title) => {
    expect(linkedTitleParts(title)).toEqual([{ text: title, code: false }])
    expect(linkedTitleLinks(title)).toEqual([])
  })

  it.each(['/guides/setup', '#install', './sibling', 'https://example.com/a?b=1#c', 'mailto:team@example.com', 'tel:+15550100', 'HTTPS://example.com'])(
    'links to %s',
    (url) => {
      expect(linkedTitleLinks(`[label](${url})`)).toEqual([{ url, text: 'label' }])
    },
  )
})

describe('linkedTitleParts on unusual brackets', () => {
  it('links the innermost bracket pair and leaves an outer bracket as text', () => {
    expect(linkedTitleParts('[a [b](/c)')).toEqual([
      { text: '[a ', code: false },
      { href: '/c', parts: [{ text: 'b', code: false }] },
    ])
  })

  it.each(['['.repeat(50_000), '[`_`'.repeat(20_000), '[\\'.repeat(30_000), '[a]('.repeat(20_000)])('reads a long run of brackets in linear time', (title) => {
    const started = performance.now()
    expect(plainLinkedTitle(title)).toBe(plainInlineText(title))
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})

describe('plainLinkedTitle', () => {
  it('reads each link as its label and each code span without its backticks', () => {
    expect(plainLinkedTitle('Install the [Thally CLI](/cli/overview)')).toBe('Install the Thally CLI')
    expect(plainLinkedTitle('Run [`thally check`](/cli/check) and `fix`')).toBe('Run thally check and fix')
    expect(plainLinkedTitle('[one](/a) [two](/b)')).toBe('one two')
  })
})

describe('linkedTitleLinks', () => {
  it('lists the links of a title in order, each with the plain text of its label', () => {
    expect(linkedTitleLinks('See [`init`](/cli/init) then [deploy](https://example.com/deploy)')).toEqual([
      { url: '/cli/init', text: 'init' },
      { url: 'https://example.com/deploy', text: 'deploy' },
    ])
  })
})
