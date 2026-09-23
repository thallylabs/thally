/** Navigation projections must agree on authored, visible, and generated routes. */

import { describe, expect, it } from 'vitest'
import { missingNavigationRoutes, navigationPagePath, projectNavigationContract } from '../navigation.js'

describe('docs.json navigation contract', () => {
  it('keeps API overview, changelog, nested, and hidden references distinct', () => {
    const projection = projectNavigationContract({
      tabs: [
        {
          tab: 'Guides',
          pages: [
            'introduction',
            { pages: ['guides/install', { pages: ['guides/advanced'] }] },
            { hidden: true, pages: ['guides/private'] },
          ],
        },
        { tab: 'API', api: {}, groups: [{ pages: ['api/introduction'] }] },
        { tab: 'Changelog', href: '/changelog' },
        { tab: 'Community', href: 'https://example.com/community' },
        { tab: 'Protocol relative', href: '//example.com/community' },
        { tab: 'Internal API', api: {}, href: '/api' },
        { tab: 'Archived', hidden: true, pages: ['archive/overview'] },
      ],
    })

    expect(projection.authoredPageIds).toEqual([
      'introduction', 'guides/install', 'guides/advanced', 'guides/private',
      'api/introduction', 'changelog', 'archive/overview',
    ])
    expect(projection.visiblePageIds.map(navigationPagePath)).toEqual([
      '/', '/guides/install', '/guides/advanced', '/api/introduction', '/changelog',
    ])
    expect(projection.duplicatePageIds).toEqual([])
    expect(projection.emptyTabs).toEqual([])
    expect(missingNavigationRoutes(projection, ['/', '/guides/install', '/api/introduction'])).toEqual([
      '/guides/advanced', '/changelog',
    ])
  })

  it('reports duplicate authored nodes and only genuinely empty visible tabs', () => {
    const projection = projectNavigationContract({
      tabs: [
        { tab: 'Docs', pages: ['introduction', { hidden: true, pages: ['introduction'] }] },
        { tab: 'Empty' },
        { tab: 'Hidden empty', hidden: true },
        { tab: 'Generated API', api: {} },
        { tab: 'External', href: 'https://example.com' },
      ],
    })
    expect(projection.duplicatePageIds).toEqual(['introduction'])
    expect(projection.emptyTabs).toEqual(['Empty'])
    expect(projection.visiblePageIds).toEqual(['introduction'])
  })
})
