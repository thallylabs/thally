import { describe, expect, it } from 'vitest'
import { pageFullTitle } from './page-meta'

describe('pageFullTitle', () => {
  it('uses og:title verbatim, without the site name', () => {
    expect(pageFullTitle({ title: 'Interact after scraping', ogTitle: 'Interact | Firecrawl', siteName: 'Firecrawl Docs', separator: ' - ' }))
      .toBe('Interact | Firecrawl')
  })

  it('appends the site name with the configured separator when there is no og:title', () => {
    expect(pageFullTitle({ title: 'Zapier', siteName: 'Firecrawl Docs', separator: ' - ' })).toBe('Zapier - Firecrawl Docs')
  })

  it('leaves the layout template in charge when nothing is configured', () => {
    expect(pageFullTitle({ title: 'Zapier', siteName: 'Firecrawl Docs' })).toBeUndefined()
  })
})
