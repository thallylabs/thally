/** Rendering contracts for canonical Mermaid fences and legacy components. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Pre } from '@/components/mdx/code-blocks'
import { Mermaid } from '@/components/mdx/mermaid'

describe('Mermaid', () => {
  it('routes Mermaid fences to the diagram renderer', () => {
    const markup = renderToStaticMarkup(
      createElement(
        Pre,
        { language: 'mermaid', code: 'flowchart LR\nA --> B' },
        createElement('code', null, 'flowchart LR\nA --> B'),
      ),
    )

    expect(markup).toContain('data-component-name="mermaid-container"')
    expect(markup).not.toContain('thally-docs-code')
  })

  it('preserves component-style chart and string-child usage', () => {
    const chartMarkup = renderToStaticMarkup(
      createElement(Mermaid, { chart: 'flowchart LR\nA --> B' }),
    )
    const childMarkup = renderToStaticMarkup(
      createElement(Mermaid, null, 'flowchart LR\nA --> B'),
    )

    expect(chartMarkup).toContain('data-component-name="mermaid-container"')
    expect(childMarkup).toContain('data-component-name="mermaid-container"')
  })

  it('degrades a missing definition without throwing', () => {
    const markup = renderToStaticMarkup(createElement(Mermaid))

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('a diagram definition is required')
  })

  it('rejects definitions large enough to block the browser renderer', () => {
    const markup = renderToStaticMarkup(
      createElement(Mermaid, { chart: 'A'.repeat(64 * 1024 + 1) }),
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('too large to render safely')
  })
})
