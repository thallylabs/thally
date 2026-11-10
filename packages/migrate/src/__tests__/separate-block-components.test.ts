/** A block component on the line after text gets a separating blank line that keeps the quote or list item around it. */

import { describe, expect, it } from 'vitest'

import { separateBlockComponents } from '../mdx.js'

describe('separateBlockComponents', () => {
  it('separates a component from the paragraph above it', () => {
    expect(separateBlockComponents('text\n<Note>hi</Note>\n')).toBe('text\n\n<Note>hi</Note>\n')
  })

  it('keeps a component inside the blockquote it is in', () => {
    expect(separateBlockComponents('> text\n> <Note>hi</Note>\n')).toBe('> text\n>\n> <Note>hi</Note>\n')
    expect(separateBlockComponents('> > text\n> > <Note>hi</Note>\n')).toBe('> > text\n> >\n> > <Note>hi</Note>\n')
  })

  it('separates a component inside a list item', () => {
    expect(separateBlockComponents('- item\n  <Note>hi</Note>\n')).toBe('- item\n\n  <Note>hi</Note>\n')
  })
})
