/** Collection destinations stay available without hydration or an overflow menu. */

import { createElement, type AnchorHTMLAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SidebarCollection } from '@/data/docs'

vi.mock('./intent-prefetch-link', () => ({
  IntentPrefetchLink: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement('a', props),
}))

import { CollectionTabs } from './collection-tabs'

function render(collections: Array<SidebarCollection>) {
  return renderToStaticMarkup(<CollectionTabs collections={collections} activeCollectionId="0" onCollectionChange={() => {}} />)
}

describe('fully readable collection tabs', () => {
  it.each([1, 8, 14, 30])('renders every link for %i collections in the initial HTML', (count) => {
    const collections = Array.from({ length: count }, (_, index) => ({
      id: String(index), label: `Collection ${index}`, href: `/collection-${index}`, sections: [],
    }))
    const html = render(collections)
    expect(html.match(/<a /g)).toHaveLength(count)
    expect(html).toContain(`--collection-count:${count}`)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).not.toMatch(/aria-haspopup|role="menu|aria-hidden|inert|truncate|text-ellipsis|line-clamp/)
    for (const collection of collections) expect(html).toContain(`title="${collection.label}"`)
  })

  it('preserves localized, external, and selection-only destinations with full escaped labels', () => {
    const html = render([
      { id: '0', label: 'Guides & FAQs', sections: [{ title: 'Guides', items: [{ id: 'faq', title: 'FAQ', href: '/zh-Hans/faq' }] }] },
      { id: 'external', label: 'Updates', href: 'https://example.com', sections: [] },
      { id: 'empty', label: '<Custom>', sections: [] },
    ])
    expect(html).toContain('href="/zh-Hans/faq"')
    expect(html).toContain('href="https://example.com" target="_blank" rel="noreferrer"')
    expect(html).toContain('<button')
    expect(html).toContain('title="Guides &amp; FAQs"')
    expect(html).toContain('&lt;Custom&gt;')
  })

  it('keeps an empty collection list safe for CSS division', () => {
    expect(render([])).toContain('--collection-count:1')
  })
})
