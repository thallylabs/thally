/**
 * Security regression tests for repository-authored banner content.
 *
 * Banner text supports a deliberately small Markdown-link subset. Rendering
 * must continue through React so HTML-like text is escaped and unsafe URL
 * schemes never become clickable links.
 */

import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseBannerContent } from '@/components/layout/site-banner'

describe('parseBannerContent', () => {
  it('escapes HTML-like text and rejects executable link schemes', () => {
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        ...parseBannerContent('<img src=x onerror=alert(1)> [click](javascript:alert(1))'),
      ),
    )

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('[click](javascript:alert(1))')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href="javascript:')
  })

  it('renders safe absolute and site-relative links', () => {
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        ...parseBannerContent('[status](https://status.example.com) [guide](/quickstart)'),
      ),
    )

    expect(html).toContain('<a href="https://status.example.com">status</a>')
    expect(html).toContain('<a href="/quickstart">guide</a>')
  })
})
