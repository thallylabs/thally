'use client'

import { Footer } from '@/components/layout/footer'
import { TopBar } from '@/components/layout/top-bar'
import { Sidebar } from '@/components/navigation/sidebar'
import { PageContainer } from '@/components/layout/sections'
import { layout, shell } from '@/config/layout'
import type { SidebarCollection, DocsJsonNavbar, DocsJsonFooter } from '@/data/docs'
import type { SearchCorpusRecord } from '@/components/search/command-search'
import { useSidebarCollectionsStore } from './sidebar-store'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export interface I18nConfig {
  defaultLocale: string
  locales: Array<{ code: string; label: string }>
}

function collectionContainsPath(collection: SidebarCollection, pathname: string, currentPath?: string) {
  if (collection.href && matchesPath(collection.href, pathname)) {
    return true
  }
  // API collections own all /api/* routes — check both full pathname and locale-stripped path
  // so the API tab is recognised on /es/api/... before the locale hydration completes.
  if (collection.api && (matchesPath('/api', pathname) || matchesPath('/api', currentPath ?? pathname))) {
    return true
  }
  return collection.sections.some((section) =>
    section.items.some((item) => matchesPath(item.href, pathname)),
  )
}

function matchesPath(targetHref: string, pathname: string) {
  if (!targetHref || /^https?:\/\//i.test(targetHref)) {
    return false
  }
  const normalizedTarget = normalizePath(targetHref)
  const normalizedPath = normalizePath(pathname)
  if (normalizedTarget === '/') {
    return normalizedPath === '/'
  }
  return normalizedPath === normalizedTarget || normalizedPath.startsWith(`${normalizedTarget}/`)
}

function normalizePath(value: string) {
  if (!value) {
    return '/'
  }
  if (value === '/') {
    return '/'
  }
  return value.endsWith('/') ? value.slice(0, -1) : value
}

interface SiteShellProps {
  children: React.ReactNode
  initialCollections: Array<SidebarCollection>
  searchIndex: Array<SearchCorpusRecord>
  i18nConfig?: I18nConfig | null
  navbarConfig?: DocsJsonNavbar | null
  footerConfig?: DocsJsonFooter | null
}

export function SiteShell({ children, initialCollections, searchIndex, i18nConfig, navbarConfig, footerConfig }: SiteShellProps) {
  const hydratedCollections = useSidebarCollectionsStore((state) => state.collections)
  const collections = hydratedCollections.length > 0 ? hydratedCollections : initialCollections
  const pathname = usePathname()
  const router = useRouter()

  // Derive currentLocale and strip locale prefix from pathname
  let currentLocale = i18nConfig?.defaultLocale ?? 'en'
  let currentPath = pathname
  if (i18nConfig) {
    for (const locale of i18nConfig.locales) {
      if (locale.code === i18nConfig.defaultLocale) continue
      if (pathname === `/${locale.code}` || pathname.startsWith(`/${locale.code}/`)) {
        currentLocale = locale.code
        currentPath = pathname.slice(locale.code.length + 1) || '/'
        break
      }
    }
  }
  const navigableCollections = collections.filter((collection) => collection.sections.length > 0)
  const matchedCollection =
    navigableCollections.find((collection) => collectionContainsPath(collection, pathname, currentPath)) ??
    navigableCollections[0] ??
    collections[0]
  // Manual override: set when user clicks a tab, cleared when pathname moves to a different collection
  const [selectedCollectionId, setSelectedCollectionId] = useState<SidebarCollection['id'] | null>(null)

  // Reset manual override whenever the user navigates to a page outside the selected collection
  useEffect(() => {
    if (!selectedCollectionId) return
    const selected = navigableCollections.find((c) => c.id === selectedCollectionId)
    if (selected && !collectionContainsPath(selected, pathname)) {
      setSelectedCollectionId(null)
    }
  }, [pathname])

  const activeCollection = (() => {
    if (selectedCollectionId) {
      const selected = navigableCollections.find((c) => c.id === selectedCollectionId)
      if (selected) return selected
    }
    return matchedCollection
  })()

  if (!activeCollection) {
    return null
  }

  // The tab to highlight. A standalone href tab (e.g. Changelog) that owns no
  // sidebar sections still wins the highlight when its href matches the current
  // path — otherwise the section-derived collection (Overview/API/…) does.
  const activeTabId =
    collections.find(
      (collection) =>
        collection.href &&
        !/^https?:\/\//.test(collection.href) &&
        (matchesPath(collection.href, pathname) || matchesPath(collection.href, currentPath)),
    )?.id ?? activeCollection.id

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-background text-foreground">
      <div className={`flex min-h-screen w-full ${shell.wrapper}`}>
        <Sidebar
          sections={activeCollection.sections}
          title={activeCollection.label}
        />
        <div className="flex min-h-screen w-full min-w-0 flex-1 flex-col">
          <TopBar
            collections={collections}
            activeCollectionId={activeTabId}
            onCollectionChange={(id) => {
              const target = collections.find((collection) => collection.id === id)
              if (!target) {
                return
              }
              setSelectedCollectionId(target.id)
              const targetHref = target.href
              const firstHref = target.sections[0]?.items[0]?.href
              if (targetHref && !matchesPath(targetHref, pathname)) {
                router.push(targetHref)
                return
              }
              if (firstHref && !collectionContainsPath(target, pathname)) {
                router.push(firstHref)
              }
            }}
            activeSections={activeCollection.sections}
            searchIndex={searchIndex}
            i18nConfig={i18nConfig ?? null}
            currentLocale={currentLocale}
            currentPath={currentPath}
            navbarConfig={navbarConfig ?? null}
          />
          <main className="flex-1 py-6 sm:py-8 lg:py-10">
            <PageContainer className={layout.pageGap}>{children}</PageContainer>
          </main>
          <Footer footerConfig={footerConfig ?? null} />
        </div>
      </div>
    </div>
  )
}

