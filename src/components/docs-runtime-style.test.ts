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
import { DocHeader } from '@/components/docs/doc-header'
import { Sidebar } from '@/components/navigation/sidebar'
import type { DocEntry } from '@/data/docs'

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
    expect(markup).toContain('data-card-tone="accent"')
  })

  it.each([
    ['card', Card],
    ['tile', Tile],
  ])('tags the %s surface with the resolved tone for accent-aware chrome', (_, Component) => {
    const site = renderToStaticMarkup(createElement(Component, { title: 'A', icon: 'book-open' }))
    const neutral = renderToStaticMarkup(
      createElement(Component, { title: 'A', icon: 'book-open', iconColor: 'neutral' }),
    )

    expect(site).toContain('data-card-tone="site"')
    expect(neutral).toContain('data-card-tone="neutral"')
  })

  it('derives accent card chrome from the live accent token, never a fixed color', async () => {
    const { readFile } = await import('node:fs/promises')
    const css = await readFile('src/styles/docs-handoff.css', 'utf8')

    // Site-wide accent opt-in and per-card override both restyle the border.
    expect(css).toContain("[data-content-icons='accent'] .thally-docs-card[data-card-tone='site']")
    expect(css).toContain(".thally-docs-card[data-card-tone='accent']")
    // Neutral opt-out restores the quiet chrome on accent sites.
    expect(css).toContain(".thally-docs-card[data-card-tone='neutral']")

    // The treatment must flow through the theme token so owner accent changes
    // (and Cloud branding) apply — a hardcoded color would freeze the default
    // green and break locale/theme consistency guarantees.
    const cardChrome = css.slice(css.indexOf("[data-content-icons='accent'] .thally-docs-card"))
    const firstBlock = cardChrome.slice(0, cardChrome.indexOf('.thally-docs-card > .prose'))
    expect(firstBlock).toContain('hsl(var(--thally-accent)')
    expect(firstBlock).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('renders the category eyebrow above the page title', () => {
    const doc = {
      id: 'guides/writing-content',
      title: 'Write great content',
      description: 'How to structure pages.',
      href: '/guides/writing-content',
    } as DocEntry

    const markup = renderToStaticMarkup(createElement(DocHeader, { doc, eyebrow: 'Create content' }))

    expect(markup).toContain('thally-docs-eyebrow')
    // The eyebrow precedes the H1 so it reads as a category label, not a crumb.
    expect(markup.indexOf('Create content')).toBeLessThan(markup.indexOf('Write great content'))

    const withoutEyebrow = renderToStaticMarkup(createElement(DocHeader, { doc }))
    expect(withoutEyebrow).not.toContain('thally-docs-eyebrow')
  })

  it('renders the eyebrow as bold sentence case, never uppercase', () => {
    const doc = {
      id: 'guides/writing-content',
      title: 'Write great content',
      description: 'How to structure pages.',
      href: '/guides/writing-content',
    } as DocEntry

    const markup = renderToStaticMarkup(
      createElement(DocHeader, { doc, eyebrow: 'Design your docs' }),
    )

    expect(markup).toContain('font-bold')
    expect(markup).not.toContain('uppercase')
  })

  it('suppresses a group heading that repeats the tab label', () => {
    const markup = renderToStaticMarkup(
      createElement(Sidebar, {
        title: 'Get started',
        sections: [
          {
            title: 'Get started',
            items: [{ id: 'introduction', title: 'Introduction', href: '/' }],
          },
          {
            title: 'Design your docs',
            items: [{ id: 'components', title: 'Components', href: '/components' }],
          },
        ],
      }),
    )

    // The tab heading renders once; the identical group heading does not.
    expect(markup.split('Get started').length - 1).toBe(1)
    expect(markup).toContain('Design your docs')
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
