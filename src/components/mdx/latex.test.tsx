/** Regression tests for Latex KaTeX rendering. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Latex } from './latex'

describe('Latex', () => {
  it('renders inline KaTeX markup', () => {
    const html = renderToStaticMarkup(<Latex>E=mc^2</Latex>)
    expect(html).toContain('class="katex"')
    expect(html).toContain('<span')
  })

  it('renders display-mode KaTeX markup when block is set', () => {
    const html = renderToStaticMarkup(<Latex block>E=mc^2</Latex>)
    expect(html).toContain('katex-display')
    expect(html).toContain('<div')
  })

  it('falls back to raw text on invalid input', () => {
    const html = renderToStaticMarkup(<Latex>{'\\unknownCommand'}</Latex>)
    expect(html).toContain('<code')
    expect(html).toContain('\\unknownCommand')
  })
})
