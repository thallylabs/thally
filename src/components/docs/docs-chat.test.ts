/** Grounded-answer source disclosure rendering coverage. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AnswerSources } from './docs-chat'

describe('AnswerSources', () => {
  it('renders an expandable page count before internal source links', () => {
    const html = renderToStaticMarkup(
      createElement(AnswerSources, {
        sources: [
          { title: 'Quickstart', url: '/quickstart#install' },
          { title: 'API reference', url: '/api/reference' },
        ],
      }),
    )

    expect(html).toContain('<details')
    expect(html).toContain('Read 2 pages')
    expect(html).toContain('href="/quickstart#install"')
    expect(html.indexOf('Read 2 pages')).toBeLessThan(html.indexOf('Quickstart'))
  })

  it('renders nothing when no source page was consulted', () => {
    expect(
      renderToStaticMarkup(createElement(AnswerSources, { sources: [] })),
    ).toBe('')
  })
})
