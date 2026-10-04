import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Step, Steps } from './steps'

describe('Step title element', () => {
  it('stays an h3 by default so native sites are unchanged', () => {
    const html = renderToStaticMarkup(<Steps><Step title="One" /></Steps>)
    expect(html).toMatch(/<h3 [^>]*>One<\/h3>/)
  })

  it('renders a non-heading paragraph for titleSize="p", set on Steps or on a Step', () => {
    for (const html of [
      renderToStaticMarkup(<Steps titleSize="p"><Step title="One" /></Steps>),
      renderToStaticMarkup(<Steps><Step title="One" titleSize="p" /></Steps>),
    ]) {
      expect(html).toMatch(/<p [^>]*>One<\/p>/)
      expect(html).not.toMatch(/<h[1-6]/)
    }
  })

  it('renders h2 and h4, and a Step keeps its own size over Steps', () => {
    expect(renderToStaticMarkup(<Steps titleSize="h2"><Step title="One" /></Steps>)).toMatch(/<h2 [^>]*>One<\/h2>/)
    const html = renderToStaticMarkup(<Steps titleSize="p"><Step title="A" titleSize="h4" /><Step title="B" /></Steps>)
    expect(html).toMatch(/<h4 [^>]*>A<\/h4>/)
    expect(html).toMatch(/<p [^>]*>B<\/p>/)
  })

  it('has no data-heading marker, so no title reaches the table of contents', () => {
    expect(renderToStaticMarkup(<Steps><Step title="One" /></Steps>)).not.toContain('data-heading')
  })
})
