/**
 * Regression coverage for the permalink affordance attached to MDX headings.
 * The heading remains the interactive target without adding a decorative mark
 * beside the authored text.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HeadingAnchor } from '@/components/mdx/heading-anchor'

describe('HeadingAnchor', () => {
  it('keeps the section permalink without rendering a hash marker', () => {
    const markup = renderToStaticMarkup(
      createElement(HeadingAnchor, { id: 'installation' }, 'Installation'),
    )

    expect(markup).toContain('href="#installation"')
    expect(markup).toContain('>Installation</a>')
    expect(markup).not.toContain('<span')
    expect(markup).not.toContain('>#</')
  })

  it('keeps an authored heading link separate from its permalink', () => {
    const markup = renderToStaticMarkup(createElement(HeadingAnchor, { id: 'details' },
      createElement('a', { href: '/guide' }, 'Guide details')))

    expect(markup).toContain('<span><a href="/guide">Guide details</a></span>')
    expect(markup).toContain('<a href="#details"')
    expect(markup).not.toMatch(/<a[^>]*>[^<]*<a/)
  })
})
