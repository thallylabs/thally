/** Focused rendering contracts for the standalone rich-content primitives. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: vi.fn() }),
}))

import { Accordion, AccordionGroup } from '@/components/mdx/accordion'
import { Card, Tile } from '@/components/mdx/content-cards'
import { Icon } from '@/components/mdx/content-icon'
import { Badge, Tooltip } from '@/components/mdx/content-inline'
import { Color, Update } from '@/components/mdx/content-metadata'

describe('standalone rich-content primitives', () => {
  it('renders a joined accordion group with linkable items', () => {
    const markup = renderToStaticMarkup(
      createElement(AccordionGroup, null,
        createElement(Accordion, { id: 'first', title: 'First', description: 'Details' }, 'Answer'),
        createElement(Accordion, { id: 'second', title: 'Second' }, 'More'),
      ),
    )
    expect(markup).toContain('id="first"')
    expect(markup).toContain('Details')
    expect(markup.match(/data-radix-collection-item/g)).toHaveLength(2)
  })

  it('uses an explicit unknown icon fallback instead of a content glyph', () => {
    const markup = renderToStaticMarkup(createElement(Icon, { icon: 'not-real' }))
    expect(markup).toContain('data-icon-name="unknown"')
    expect(markup).toContain('aria-hidden="true"')
  })

  it.each([Card, Tile])('supports richer linked surface metadata', (Component) => {
    const markup = renderToStaticMarkup(createElement(Component, {
      title: 'Deploy', href: 'https://example.com', icon: 'cloud', iconColor: '#0ea5e9',
      horizontal: true, cta: 'Read guide', callout: 'info',
    }, 'Ship safely.'))
    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('data-callout="info"')
    expect(markup).toContain('Read guide')
    expect(markup).toContain('stroke="#0ea5e9"')
    const unsafe = renderToStaticMarkup(createElement(Component, { title: 'Unsafe', href: 'javascript:alert(1)' }))
    expect(unsafe).not.toContain('href=')
  })

  it('renders rich badge and tooltip semantics', () => {
    const badge = renderToStaticMarkup(createElement(Badge, { variant: 'outline', size: 'lg' }, 'Beta'))
    const tooltip = renderToStaticMarkup(createElement(Tooltip, { headline: 'JWT', tip: 'Authentication token', cta: 'Learn', href: '/auth' }, 'token'))
    expect(badge).toContain('Beta')
    expect(tooltip).toContain('role="tooltip"')
    expect(tooltip).toContain('data-tooltip-surface=""')
    expect(tooltip).toContain('data-tooltip-placement="top"')
    expect(tooltip).toContain('absolute left-1/2')
    expect(tooltip).toContain('bg-card')
    expect(tooltip).toContain('before:top-full before:h-2')
    expect(tooltip).toContain('cursor-pointer')
    expect(tooltip).toContain('href="/auth"')
    const unsafe = renderToStaticMarkup(createElement(Tooltip, { tip: 'No link', cta: 'Run', href: 'javascript:alert(1)' }, 'token'))
    expect(unsafe).not.toContain('javascript:')
  })

  it('preserves legacy colors and adds compound palette items', () => {
    const legacy = renderToStaticMarkup(createElement(Color, { hex: '#10b981', name: 'Emerald' }))
    const compound = renderToStaticMarkup(createElement(Color.Row, null, createElement(Color.Item, { color: 'red', name: 'Danger' })))
    expect(legacy).toContain('Emerald')
    expect(legacy).toContain('#10b981')
    expect(compound).toContain('Danger')
    const themed = renderToStaticMarkup(createElement(Color.Item, { name: 'Accent', light: '#7AA600', dark: '#B8EC36' }))
    expect(themed).toContain('light #7AA600, dark #B8EC36')
  })

  it('renders updates as linkable timeline entries with semantic dates and tags', () => {
    const markup = renderToStaticMarkup(createElement(Update, { label: 'Version 2', date: '2026-08-21', tags: ['API'] }, 'Released.'))
    expect(markup).toContain('id="version-2"')
    expect(markup).toContain('dateTime="2026-08-21"')
    expect(markup).toContain('API')
  })
})
