/** Locale navigation keeps the current collection before and after its snapshot hydrates. */

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SidebarCollection } from '@/data/docs'

const mocks = vi.hoisted(() => ({
  pathname: '/zh-Hans/guides/fees-monetization/faq',
  snapshots: {} as Record<string, Array<SidebarCollection>>,
  loadCollections: vi.fn(),
}))
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }))
vi.mock('@/data/docs', () => ({ loadSidebarCollections: mocks.loadCollections }))
vi.mock('@/data/api-reference', () => ({ buildApiNavigation: async () => [] }))
vi.mock('./sidebar-store', () => ({
  useSidebarCollectionsStore: (selector: (state: { collectionsByScope: typeof mocks.snapshots }) => unknown) => selector({ collectionsByScope: mocks.snapshots }),
}))
vi.mock('./sidebar-hydrator', () => ({ SidebarCollectionsHydrator: () => null }))
vi.mock('@/components/layout/top-bar', () => ({
  TopBar: ({ activeCollectionId }: { activeCollectionId: string }) => createElement('nav', { 'data-active': activeCollectionId }),
}))
vi.mock('@/components/navigation/sidebar', () => ({
  Sidebar: ({ activeCollectionId }: { activeCollectionId: string }) => createElement('aside', { 'data-active': activeCollectionId }),
}))
vi.mock('@/components/layout/footer', () => ({ Footer: () => null }))
vi.mock('@/components/layout/sections', () => ({ PageContainer: ({ children }: { children: ReactNode }) => children }))

import { LocalizedSidebarHydrator } from './localized-sidebar-hydrator'
import { SiteShell } from './site-shell'

function collections(prefix = ''): Array<SidebarCollection> {
  return [
    { id: 'overview', label: 'Overview', sections: [{ title: 'Overview', items: [
      { id: 'introduction/introduction', title: 'Introduction', href: `${prefix}/introduction/introduction` },
    ] }] },
    { id: 'guides', label: 'Guides', sections: [{ title: 'Guides', items: [
      { id: 'guides/fees-monetization/faq', title: 'FAQ', href: `${prefix}/guides/fees-monetization/faq` },
    ] }] },
  ]
}

function shellMarkup(initialCollections = collections()) {
  return renderToStaticMarkup(
    <SiteShell
      initialCollections={initialCollections}
      navigationPresentation={{ display: 'tabs' }}
      i18nConfig={{ defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }, { code: 'zh-Hans', label: 'Chinese' }] }}
      identity={{ name: 'Documentation', description: '', repoUrl: '', links: [] }}
    >
      Page
    </SiteShell>,
  )
}

describe('localized collection selection', () => {
  beforeEach(() => {
    mocks.pathname = '/zh-Hans/guides/fees-monetization/faq'
    mocks.snapshots = {}
    mocks.loadCollections.mockResolvedValue(collections('/zh-Hans'))
  })

  it('selects Guides from primary hrefs before localized navigation arrives', () => {
    const markup = shellMarkup()
    expect(markup).toContain('<nav data-active="guides"')
    expect(markup).toContain('<aside data-active="guides"')
  })

  it('keeps Guides selected after the localized snapshot arrives', async () => {
    const hydration = await LocalizedSidebarHydrator({ locale: 'zh-Hans' })
    expect(mocks.loadCollections).toHaveBeenCalledWith('zh-Hans')
    expect(hydration.props.collections.find((collection: SidebarCollection) => collection.id === 'overview')?.href).toBeUndefined()
    mocks.snapshots['locale:zh-Hans'] = hydration.props.collections
    const markup = shellMarkup()
    expect(markup).toContain('<nav data-active="guides"')
    expect(markup).toContain('<aside data-active="guides"')
  })

  it('keeps the dedicated header row when localized collection counts change', () => {
    const initial = [...collections(), ...Array.from({ length: 4 }, (_, index) => ({
      id: `extra-${index}`, label: `Extra ${index}`, href: `/extra-${index}`, sections: [],
    }))]
    expect(shellMarkup(initial)).toContain('data-header-layout="stacked"')
    mocks.snapshots['locale:zh-Hans'] = [...initial, { id: 'seventh', label: 'Seventh', href: '/seventh', sections: [] }]
    expect(shellMarkup(initial)).toContain('data-header-layout="stacked"')
    mocks.snapshots['locale:zh-Hans'] = initial
    expect(shellMarkup(initial)).toContain('data-header-layout="stacked"')
  })

  it('localizes authored collection destinations without inventing new ones', async () => {
    mocks.loadCollections.mockResolvedValue([
      ...collections('/zh-Hans'),
      { id: 'changelog', label: 'Changelog', href: '/changelog', sections: [] },
      { id: 'external', label: 'External', href: 'https://example.com', sections: [] },
    ])
    const hydration = await LocalizedSidebarHydrator({ locale: 'zh-Hans' })
    expect(hydration.props.collections[2].href).toBe('/zh-Hans/changelog')
    expect(hydration.props.collections[3].href).toBe('https://example.com')
  })

  it.each(['collection', 'page'])('keeps an authored locale root %s from owning sibling collections', async (kind) => {
    const localized = collections('/zh-Hans')
    if (kind === 'collection') localized[0].href = '/'
    else localized[0].sections[0].items[0].href = '/zh-Hans'
    mocks.loadCollections.mockResolvedValue(localized)
    const hydration = await LocalizedSidebarHydrator({ locale: 'zh-Hans' })
    mocks.snapshots['locale:zh-Hans'] = hydration.props.collections
    expect(shellMarkup()).toContain('<nav data-active="guides"')
    expect(shellMarkup()).toContain('<aside data-active="guides"')

    // Root destinations still own the locale landing page itself.
    mocks.pathname = '/zh-Hans'
    expect(shellMarkup()).toContain('<nav data-active="overview"')
    expect(shellMarkup()).toContain('<aside data-active="overview"')
  })
})
