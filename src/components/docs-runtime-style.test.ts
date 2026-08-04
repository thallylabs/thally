/**
 * Runtime checks for the quiet, content-first documentation chrome.
 *
 * These assertions protect the visual invariants that are easy to regress
 * when brand colors or navigation treatments change: cards keep neutral
 * icons, and the desktop sidebar remains rail-free without losing a visible
 * current-page state.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/guides/quickstart',
  useRouter: () => ({ prefetch: vi.fn() }),
}))

import { Card, Tile } from '@/components/mdx/rich-content'
import { Sidebar } from '@/components/navigation/sidebar'

describe('documentation visual system', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['card', Card],
    ['tile', Tile],
  ])('keeps %s icons neutral while preserving border-only surfaces', (_, Component) => {
    const markup = renderToStaticMarkup(
      createElement(
        Component,
        { title: 'Quickstart', icon: 'book-open' },
        createElement('p', null, 'Publish the first useful page.'),
      ),
    )

    expect(markup).toContain('thally-content-icon')
    expect(markup).toContain('data-content-icon-tone="site"')
    expect(markup).toContain('border border-border')
    expect(markup).toContain('hover:border-foreground/25')
    expect(markup).not.toContain('shadow-')
  })

  it.each([
    ['card', Card],
    ['tile', Tile],
  ])('lets %s icons inherit the live brand accent', (_, Component) => {
    const markup = renderToStaticMarkup(
      createElement(Component, { title: 'Quickstart', icon: 'book-open', iconColor: 'accent' }),
    )

    expect(markup).toContain('data-content-icon-tone="accent"')
  })

  it('renders a rail-free sidebar with a visible current-page state', () => {
    const markup = renderToStaticMarkup(
      createElement(Sidebar, {
        title: 'Guides',
        sections: [
          {
            title: 'Getting started',
            items: [
              { id: 'quickstart', title: 'Quickstart', href: '/guides/quickstart' },
              { id: 'configuration', title: 'Configuration', href: '/guides/configuration' },
            ],
          },
        ],
      }),
    )

    expect(markup).not.toContain('border-r')
    expect(markup).not.toContain('thally-sidebar-indicator')
    expect(markup).not.toContain('bg-border')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('bg-muted/70')
  })
})
