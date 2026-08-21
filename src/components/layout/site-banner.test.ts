/**
 * Security regression tests for repository-authored banner content.
 *
 * Banner text supports a deliberately small Markdown-link subset. Rendering
 * must continue through React so HTML-like text is escaped and unsafe URL
 * schemes never become clickable links.
 */

import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BannerPreview, parseBannerContent, SiteBanner } from '@/components/layout/site-banner'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

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

    expect(html).toContain('<a href="https://status.example.com" rel="noreferrer">status</a>')
    expect(html).toContain('<a href="/quickstart">guide</a>')
  })

  it('rejects protocol-relative and backslash-relative links', () => {
    const html = renderToStaticMarkup(
      createElement(Fragment, null, ...parseBannerContent('[bad](//evil.example) [also bad](/\\evil.example)')),
    )
    expect(html).not.toContain('href="//evil.example"')
    expect(html).not.toContain('href="/\\evil.example"')
  })

  it('server-renders non-dismissible banners for no-JavaScript readers', () => {
    const html = renderToStaticMarkup(
      createElement(SiteBanner, { banner: { content: 'Service is healthy', variant: 'info' } }),
    )
    expect(html).toContain('Service is healthy')
    expect(html).toContain('data-variant="info"')
    expect(html).not.toContain('Dismiss banner')
  })

  it('accepts validated theme colors and ignores arbitrary CSS values', () => {
    const safe = renderToStaticMarkup(
      createElement(SiteBanner, { banner: { content: 'Safe', color: { light: '#123abc' } } }),
    )
    const unsafe = renderToStaticMarkup(
      createElement(SiteBanner, { banner: { content: 'Unsafe', color: { light: 'url(javascript:alert(1))' } } }),
    )
    expect(safe).toContain('--thally-banner-light:#123abc')
    expect(unsafe).not.toContain('javascript')
  })

  it('renders the documentation preview with the production banner treatment', () => {
    const html = renderToStaticMarkup(
      createElement(BannerPreview, {
        content: 'Maintenance starts Saturday at 02:00 UTC.',
        type: 'warning',
        dismissible: true,
      }),
    )

    expect(html).toContain('Site banner preview')
    expect(html).toContain('data-variant="warning"')
    expect(html).toContain('Maintenance starts Saturday at 02:00 UTC.')
    expect(html).toContain('aria-label="Dismiss banner"')
  })
})
