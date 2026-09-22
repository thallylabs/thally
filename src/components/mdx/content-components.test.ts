/** Focused rendering contracts for the standalone rich-content primitives. */
import { createElement, type ComponentType, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: vi.fn() }),
}))

import { Accordion, AccordionGroup } from '@/components/mdx/accordion'
import { Card, CardGroup, Tile } from '@/components/mdx/content-cards'
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

  it('resolves unknown names through the configured icon library instead of a placeholder glyph', () => {
    const markup = renderToStaticMarkup(createElement(Icon, { icon: 'sunrise-over-hills' }))
    expect(markup).toContain('data-icon-source="library"')
    expect(markup).toContain('data-icon-name="sunrise-over-hills"')
    expect(markup).toContain('thally-icon-mask')
    expect(markup).toContain('lucide-static@')
    expect(markup).toContain('fontawesome-free@')
    expect(markup).toContain('@tabler/icons@')
    expect(markup).not.toContain('<svg')
    expect(markup).toContain('aria-hidden="true"')
    // Names that cannot form a safe URL render nothing at all.
    expect(renderToStaticMarkup(createElement(Icon, { icon: 'not real!' }))).toBe('')
    expect(renderToStaticMarkup(createElement(Icon, { icon: '../etc' }))).toBe('')
  })

  it('renders brand marks inline under every icon library', () => {
    for (const name of ['python', 'node', 'golang', 'java', 'rust', 'php', 'x-twitter', 'fa-brands fa-github']) {
      const markup = renderToStaticMarkup(createElement(Icon, { icon: name }))
      expect(markup, name).toContain('data-icon-source="brand"')
      expect(markup, name).toContain('<path')
    }
    // Font Awesome brands without an inline mark fall back to the brands set for all libraries.
    const microsoft = renderToStaticMarkup(createElement(Icon, { icon: 'microsoft' }))
    expect(microsoft).toContain('data-icon-source="library"')
    expect(microsoft.match(/svgs\/brands\/microsoft\.svg/g)).toHaveLength(3)
  })

  it('keeps a bundled Lucide glyph beside the library mask for the same name', () => {
    const markup = renderToStaticMarkup(createElement(Icon, { icon: 'gear' }))
    expect(markup).toContain('data-icon-source="lucide"')
    expect(markup).toContain('data-icon-name="gear"')
    expect(markup).toContain('thally-icon-glyph')
    expect(markup).toContain('svgs/solid/gear.svg')
    expect(markup).toContain('icons/outline/gear.svg')
    expect(renderToStaticMarkup(createElement(Icon, { icon: 'bell', iconType: 'regular' }))).toContain('svgs/regular/bell.svg')
    expect(renderToStaticMarkup(createElement(Icon, { icon: 'star', iconType: 'solid' }))).toContain('icons/filled/star.svg')
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

  it('stacks the icon above the title and hides the arrow unless asked', () => {
    const markup = renderToStaticMarkup(createElement(Card, {
      title: 'Python SDK', icon: 'terminal', href: '/sdks/python',
    }, 'For Python apps.'))
    expect(markup).toContain('data-card-layout="stacked"')
    expect(markup.indexOf('thally-docs-card-icon')).toBeLessThan(markup.indexOf('Python SDK'))
    // A literal radius keeps cards rounded under the sharp and minimal presets,
    // where the theme-mapped `rounded-2xl` utility collapses to 4px or 0.
    expect(markup).toContain('rounded-[16px]')
    expect(markup).not.toMatch(/thally-docs-card[^"]*rounded-(?:md|lg|xl|2xl|3xl)\b/)
    expect(markup).toContain('px-6 py-5')
    expect(markup).not.toContain('thally-docs-card-arrow')
    expect(markup).not.toContain('data-card-arrow')

    const withArrow = renderToStaticMarkup(createElement(Card, { title: 'Go', href: '/go', arrow: true }))
    expect(withArrow).toContain('data-card-arrow=""')
    expect(withArrow).toContain('thally-docs-card-arrow absolute right-5 top-5')

    const horizontal = renderToStaticMarkup(createElement(Card, { title: 'Guide', icon: 'book', horizontal: true }))
    expect(horizontal).toContain('data-card-layout="horizontal"')
  })

  it('lays card groups out in two columns unless told otherwise', () => {
    // CardGroup requires children in its prop type; createElement passes them positionally.
    const Group = CardGroup as ComponentType<{ cols?: number | string; children?: ReactNode }>
    const child = createElement(Card, { title: 'A' })
    const grid = renderToStaticMarkup(createElement(Group, null, child))
    expect(grid).toContain('grid grid-cols-1 gap-4 sm:grid-cols-2')
    expect(grid).not.toContain('lg:grid-cols-3')
    const three = renderToStaticMarkup(createElement(Group, { cols: 3 }, child))
    expect(three).toContain('lg:grid-cols-3')
    const fromString = renderToStaticMarkup(createElement(Group, { cols: '4' }, child))
    expect(fromString).toContain('lg:grid-cols-4')
  })

  it('renders Mintlify cards with authored JSX icons', () => {
    const markup = renderToStaticMarkup(createElement(Card, {
      title: 'Follow us',
      icon: createElement('svg', { viewBox: '0 0 20 20', 'data-custom-icon': 'x' },
        createElement('path', { d: 'M1 1h18v18H1z' })),
    }))
    expect(markup).toContain('data-custom-icon="x"')
    expect(markup).toContain('<path')
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
