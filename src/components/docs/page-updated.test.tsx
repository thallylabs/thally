/** Reader labels distinguish proven updates from an initial imported publication. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PageUpdated } from './page-updated'

describe('page-date label', () => {
  it('uses a semantic time element with the canonical source date', () => {
    const html = renderToStaticMarkup(createElement(PageUpdated, { pageUpdate: { date: '2026-11-27T00:00:00Z', source: 'git' } }))
    expect(html).toContain('Updated')
    expect(html).toContain('dateTime="2026-11-27T00:00:00Z"')
    expect(html).toContain('Nov 27, 2026')
  })
  it('labels unknown-history initial publication truthfully', () => {
    const html = renderToStaticMarkup(createElement(PageUpdated, { pageUpdate: { date: '2026-11-27', source: 'first-published' } }))
    expect(html).toContain('Published')
    expect(html).not.toContain('Updated')
  })
  it('does not fabricate a date for an old artifact without provenance', () => {
    expect(renderToStaticMarkup(createElement(PageUpdated, {}))).toBe('')
  })
})
