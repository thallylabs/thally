/**
 * Runtime checks for the quiet, content-first documentation chrome.
 *
 * These assertions protect the visual invariants that are easy to regress
 * when brand colors or navigation treatments change: cards keep neutral
 * icons, and the desktop sidebar remains rail-free without losing a visible
 * current-page state.
 */

import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/guides/quickstart',
  useRouter: () => ({ prefetch: vi.fn() }),
}))

import { Card, Tile } from '@/components/mdx/rich-content'
import { AgentPrompt } from '@/components/mdx/agent-prompt'
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
    expect(markup).not.toContain('hover:bg-')
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
    expect(firstBlock).not.toContain('background-color')
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

  it('can remove the copy action without removing the document header', () => {
    const doc = {
      id: 'guides/writing-content',
      title: 'Write great content',
      description: 'How to structure pages.',
      href: '/guides/writing-content',
    } as DocEntry

    const markup = renderToStaticMarkup(
      createElement(DocHeader, { doc, showCopyPage: false }),
    )

    expect(markup).toContain(doc.title)
    expect(markup).not.toContain('Copy page')
  })

  it('renders the eyebrow as semibold sentence case, never uppercase', () => {
    const doc = {
      id: 'guides/writing-content',
      title: 'Write great content',
      description: 'How to structure pages.',
      href: '/guides/writing-content',
    } as DocEntry

    const markup = renderToStaticMarkup(
      createElement(DocHeader, { doc, eyebrow: 'Design your docs' }),
    )

    expect(markup).toContain('font-semibold')
    expect(markup).not.toContain('uppercase')
  })

  it('keeps agent prompts as two-line callouts with a secondary copy action', () => {
    const props: ComponentProps<typeof AgentPrompt> = {
      title: 'Copy a complete prompt to write a page',
      children: createElement('p', null, 'Write one task-focused page.'),
    }
    const markup = renderToStaticMarkup(
      createElement(AgentPrompt, props),
    )

    expect(markup).toContain('Prefer to let an agent do it?')
    expect(markup).toContain('Copy a complete prompt to write a page')
    expect(markup).toContain('border border-input bg-transparent')
    expect(markup).not.toContain('bg-primary')
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
    expect(markup).toContain('bg-accent/10')
    expect(markup).toContain('text-accent')
    expect(markup).toContain('text-base')
  })

  it('renders nested groups recursively instead of flattening duplicate headings', () => {
    const triggering = { id: 'triggering', title: 'Triggering', href: '/triggering' }
    const overview = { id: 'tasks-overview', title: 'Overview', href: '/tasks/overview' }
    const runs = { id: 'runs', title: 'Runs', href: '/runs' }
    const markup = renderToStaticMarkup(
      createElement(Sidebar, {
        title: 'Documentation',
        sections: [{
          id: 'fundamentals',
          title: 'Fundamentals',
          items: [triggering, overview, runs],
          nodes: [
            { type: 'page', item: triggering },
            {
              type: 'group',
              group: {
                id: 'fundamentals-tasks',
                title: 'Tasks',
                nodes: [{ type: 'page', item: overview }],
              },
            },
            { type: 'page', item: runs },
          ],
        }],
      }),
    )

    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('Tasks')
    expect(markup).not.toContain('Fundamentals • Tasks')
    expect(markup.indexOf('Triggering')).toBeLessThan(markup.indexOf('Tasks'))
    expect(markup.indexOf('Tasks')).toBeLessThan(markup.indexOf('Runs'))
  })

  it('can suppress authored group icons without removing group headings', () => {
    const sections = [{
      id: 'guides',
      title: 'Guides',
      icon: 'book-open',
      items: [{ id: 'quickstart', title: 'Quickstart', href: '/guides/quickstart' }],
      nodes: [{
        type: 'group' as const,
        group: {
          id: 'tools',
          title: 'Developer tools',
          icon: 'code',
          nodes: [{
            type: 'page' as const,
            item: { id: 'quickstart', title: 'Quickstart', href: '/guides/quickstart' },
          }],
        },
      }],
    }]
    const withIcons = renderToStaticMarkup(
      createElement(Sidebar, { title: 'Documentation', sections }),
    )
    const withoutIcons = renderToStaticMarkup(
      createElement(Sidebar, {
        title: 'Documentation',
        sections,
        showGroupIcons: false,
      }),
    )

    expect(withIcons).toContain('data-icon-name="book-open"')
    expect(withIcons).toContain('data-icon-name="code"')
    expect(withoutIcons).not.toContain('data-icon-name="book-open"')
    expect(withoutIcons).not.toContain('data-icon-name="code"')
    expect(withoutIcons).toContain('Developer tools')
  })

  it('renders source dropdown metadata as a sidebar collection selector', () => {
    const sections = [{
      id: 'start',
      title: 'Getting started',
      items: [{ id: 'introduction', title: 'Introduction', href: '/' }],
    }]
    const markup = renderToStaticMarkup(
      createElement(Sidebar, {
        title: 'Documentation',
        sections,
        collections: [
          {
            id: 'documentation',
            label: 'Documentation',
            description: 'Resources for developers',
            icon: 'book-open',
            sections,
          },
          {
            id: 'api-reference',
            label: 'API reference',
            description: 'The product API',
            icon: 'code',
            sections: [{
              id: 'api',
              title: 'API reference',
              items: [{ id: 'api-overview', title: 'Overview', href: '/api/overview' }],
            }],
          },
        ],
        activeCollectionId: 'documentation',
        onCollectionChange: vi.fn(),
        navigationPresentation: { display: 'dropdown' },
      }),
    )

    expect(markup).toContain('thally-collection-selector')
    expect(markup).toContain('Resources for developers')
    expect(markup).toContain('href="/api/overview"')
  })

  it('keeps a readable sidebar title when a dropdown has only one collection', () => {
    const sections = [{
      id: 'start',
      title: 'Getting started',
      items: [{ id: 'introduction', title: 'Introduction', href: '/' }],
    }]
    const markup = renderToStaticMarkup(
      createElement(Sidebar, {
        title: 'Documentation',
        sections,
        collections: [{ id: 'documentation', label: 'Documentation', sections }],
        activeCollectionId: 'documentation',
        onCollectionChange: vi.fn(),
        navigationPresentation: { display: 'dropdown' },
      }),
    )

    expect(markup).not.toContain('thally-collection-selector')
    expect(markup).toContain('Documentation')
  })

  it('keeps the standard navbar spacious and reserves compaction for dense navigation', async () => {
    const { readFile } = await import('node:fs/promises')
    const [topBar, css, layout, shell, sidebar] = await Promise.all([
      readFile('src/components/layout/top-bar.tsx', 'utf8'),
      readFile('src/styles/docs-handoff.css', 'utf8'),
      readFile('src/config/layout.ts', 'utf8'),
      readFile('src/components/layout/site-shell.tsx', 'utf8'),
      readFile('src/components/navigation/sidebar.tsx', 'utf8'),
    ])

    expect(topBar).toContain("data-density={isCrowded ? 'compact' : 'comfortable'}")
    expect(topBar).not.toContain('data-navigation-mode')
    expect(topBar).not.toContain('isNavigationCompact')
    expect(topBar).toContain("className={cn('thally-docs-topbar-inner flex h-[60px]")
    expect(topBar).toContain('thally-docs-primary inline-flex h-9 shrink-0')
    expect(css).toMatch(/\.thally-docs-search \{\s*width: 230px;/)
    expect(css).toContain("[data-density='compact'] .thally-docs-search")
    expect(css).toContain('padding-inline: 12px 44px')
    expect(css).toMatch(
      /\.thally-docs-search > button:first-of-type kbd \{[\s\S]*?position: absolute;[\s\S]*?inset-inline-end: 4px;/,
    )
    expect(css).toMatch(
      /@media \(max-width: 880px\) \{[\s\S]*?\.thally-docs-topbar-inner > button\[aria-haspopup='dialog'\][\s\S]*?display: inline-flex;/,
    )
    expect(css).not.toContain("[data-navigation-mode='compact']")
    expect(css).toMatch(
      /@media \(max-width: 880px\) \{[\s\S]*?\.thally-docs-brand > span:last-child[\s\S]*?\.thally-docs-search,[\s\S]*?width: 36px;/,
    )
    expect(css).toMatch(
      /\.thally-callout-content > :last-child \{\s*margin-bottom: 0;/,
    )
    expect(layout).toContain("topbarHeight: 'h-[60px]'")
    expect(shell).toContain('calc(100dvh-60px)')
    expect(sidebar).toContain('sticky top-[60px]')
  })

  it('docks chat over a dismissible scrim with the fixed Thally identity', async () => {
    const { readFile } = await import('node:fs/promises')
    const [chat, provider, statusRoute] = await Promise.all([
      readFile('src/components/docs/docs-chat.tsx', 'utf8'),
      readFile('src/components/docs/code-actions-provider.tsx', 'utf8'),
      readFile('src/app/api/chat-status/route.ts', 'utf8'),
    ])

    expect(chat).toContain('thally-docs-chat-scrim')
    expect(chat).toContain("event.key === 'Escape'")
    expect(chat).toContain('/brand/default-favicon-light.svg')
    expect(chat).toContain("width: expanded ? 'min(680px, 100vw)' : 'min(460px, 100vw)'")
    expect(chat).not.toContain('<FabIcon')
    expect(provider).toContain('icon={chatStatus.icon ?? icon}')
    expect(statusRoute).toContain("/^\\/[A-Za-z0-9._/-]+$/")
    expect(statusRoute).toContain('{ show, label, disclaimer, icon }')
  })
})
