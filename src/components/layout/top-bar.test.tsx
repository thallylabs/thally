/** Every tab collection gets its own header row without duplicating navigation links. */

import { createElement, type AnchorHTMLAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { getHeaderNavigationLayout } from '@/components/navigation/header-layout'

vi.mock('@/components/navigation/mobile-nav', () => ({ MobileNav: () => null }))
vi.mock('@/components/search/command-search', () => ({ CommandSearch: () => <button>Search</button> }))
vi.mock('@/components/theme/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/docs/version-switcher', () => ({ VersionSwitcher: () => null }))
vi.mock('@/components/layout/locale-switcher', () => ({ LocaleSwitcher: () => <button>Language</button> }))
vi.mock('@/components/layout/logo', () => ({ Logo: () => null }))
vi.mock('@/components/layout/use-site-name', () => ({ useSiteName: () => 'Example', displaySiteName: (name: string) => name }))
vi.mock('@/components/docs/code-actions-provider', () => ({
  useDocsCodeActions: () => ({ hasAssistantEntryPoint: true, assistantLabel: 'Assistant', openAssistant: vi.fn() }),
}))
vi.mock('@/components/navigation/intent-prefetch-link', () => ({
  IntentPrefetchLink: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement('a', props),
}))

import { TopBar } from './top-bar'

function markup(count: number, display: 'tabs' | 'dropdown' = 'tabs') {
  return renderToStaticMarkup(<TopBar
    collections={Array.from({ length: count }, (_, index) => ({ id: String(index), label: `Section ${index}`, href: `/section-${index}`, sections: [] }))}
    activeCollectionId="0"
    onCollectionChange={() => {}}
    activeSections={[]}
    navigationPresentation={{ display }}
    i18nConfig={{ defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' }] }}
    navbarConfig={{ links: Array.from({ length: 8 }, (_, index) => ({ label: `Action ${index}`, href: `/action-${index}` })), primary: { label: 'Start', href: '/start' } }}
    siteLinks={[]}
  />)
}

describe('automatic header navigation rows', () => {
  it.each([1, 4, 6, 7, 14])('places %i collections in an aligned second row even with extra header actions', (count) => {
    const html = markup(count)
    expect(getHeaderNavigationLayout('tabs', count)).toBe('stacked')
    expect(html).toContain('thally-docs-collection-row')
    expect(html).not.toContain('thally-docs-inline-collections')
    expect(html.indexOf('thally-docs-collection-row')).toBeGreaterThan(html.indexOf('thally-docs-actions'))
    expect(html.match(/href="\/section-/g)).toHaveLength(count)
    expect(html.match(/aria-label="Documentation sections"/g)).toHaveLength(1)
  })

  it.each([0, 6, 7, 14])('preserves explicit dropdown navigation with %i collections', (count) => {
    expect(getHeaderNavigationLayout('dropdown', count)).toBe('none')
    expect(markup(count, 'dropdown')).not.toMatch(/thally-docs-inline-collections|thally-docs-collection-row|aria-label="Documentation sections"/)
  })

  it('has no empty tab row and keeps the same layout when the count changes', () => {
    expect(getHeaderNavigationLayout('tabs', 0)).toBe('none')
    expect(markup(0)).not.toContain('aria-label="Documentation sections"')
    expect([6, 7, 6].map(count => getHeaderNavigationLayout('tabs', count))).toEqual(['stacked', 'stacked', 'stacked'])
  })
})
