/** The runtime's inline-code helpers read titles exactly as the content parser and `thally check` do. */

import { describe, expect, it } from 'vitest'
import {
  inlineCodeParts as coreParts, linkedTitleLinks as coreLinks, linkedTitleParts as coreLinkedParts,
  plainInlineText as corePlain, plainLinkedTitle as corePlainLinked,
} from '@thallylabs/core/slugify'
import { inlineCodeParts, linkedTitleLinks, linkedTitleParts, plainInlineText, plainLinkedTitle } from '../inline-code'

describe('inline code helpers', () => {
  it.each([
    'Run the CLI `init` command',
    'Don\'t use this in parallel, e.g. with `Promise.all()`',
    '`a`b',
    '`one` and `two`',
    'Use the ` key',
    'Empty `` pair',
    '**bold** and `x`',
    'Create a project',
    '',
  ])('matches @thallylabs/core for %j', (title) => {
    expect(inlineCodeParts(title)).toEqual(coreParts(title))
    expect(plainInlineText(title)).toBe(corePlain(title))
  })

  it('reads the plain text of the code runs it splits out', () => {
    for (const title of ['Run the CLI `init` command', '`a`b', 'Create a project']) {
      expect(inlineCodeParts(title).map((part) => part.text).join('')).toBe(plainInlineText(title))
    }
  })
})

describe('linked title helpers', () => {
  it.each([
    'Install the [Thally CLI](/cli/overview)',
    '[Create a project](https://example.com/new) first',
    'Run [`thally check`](/cli/check) and `fix`',
    '`[not a link](/x)`',
    '![image](/logo.png)',
    '\\[escaped](/x)',
    '[script](javascript:alert(1))',
    '[bad](javascript:void)',
    '[ ](/blank)',
    'Array[0](x) and [two](#a) [three](mailto:a@b.co)',
    'Run the CLI `init` command',
    'Create a project',
    '',
  ])('matches @thallylabs/core for %j', (title) => {
    expect(linkedTitleParts(title)).toEqual(coreLinkedParts(title))
    expect(plainLinkedTitle(title)).toBe(corePlainLinked(title))
    expect(linkedTitleLinks(title)).toEqual(coreLinks(title))
  })
})
