/** The first paragraph keeps inline text of elements inside prose; only form chrome is skipped. */

import { describe, expect, it } from 'vitest'

import { parseMarkdownPage } from '../mdx.js'
import type { MigrationPlatform } from '../types.js'

function described(body: string, platform: MigrationPlatform = 'mintlify'): string | undefined {
  const raw = `---\ntitle: T\n---\n\n${body}\n`
  return parseMarkdownPage({ id: 't', raw, source: 't.mdx', platform })?.description
}

describe('a description taken from the first paragraph', () => {
  it('keeps the text of a button or label inside a sentence', () => {
    expect(described('Press the <button>Save</button> button to apply the changes now.')).toBe('Press the Save button to apply the changes now.')
    expect(described('Enter your <label>Name</label> in the box below to continue.', 'fern')).toBe('Enter your Name in the box below to continue.')
  })

  it('skips a paragraph that is only form controls', () => {
    expect(described('<label htmlFor="e">E-mail address</label>\n<input id="e" />\n\nReal intro.')).toBe('Real intro.')
    expect(described('<form action="/s"><label htmlFor="e">E-mail address</label></form>\n\nReal intro.')).toBe('Real intro.')
  })
})
