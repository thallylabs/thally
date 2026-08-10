'use client'

import { Footer } from '@/components/layout/footer'
import { TopBar } from '@/components/layout/top-bar'
import { Sidebar } from '@/components/navigation/sidebar'
import { PageContainer } from '@/components/layout/sections'
import { layout, shell } from '@/config/layout'
import type { SidebarCollection, DocsJsonNavbar, DocsJsonFooter } from '@/data/docs'
import { useSidebarCollectionsStore } from './sidebar-store'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { SiteNameProvider } from '@/components/layout/use-site-name'
import type { SiteIdentity } from '@/lib/site-config'

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
  i18nConfig?: I18nConfig | null
  navbarConfig?: DocsJsonNavbar | null
  footerConfig?: DocsJsonFooter | null
  identity: SiteIdentity
}

export function SiteShell({
  children,
  initialCollections,
  i18nConfig,
  navbarConfig,
  footerConfig,
  identity,
}: SiteShellProps) {
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
  // Manual override: set when the user clicks a tab and ignored once navigation
  // leaves that collection. Deriving validity here avoids an effect-driven state reset.
  const [selectedCollectionId, setSelectedCollectionId] = useState<SidebarCollection['id'] | null>(null)
  const selectedCollection = navigableCollections.find((collection) => collection.id === selectedCollectionId)
  const activeCollection =
    selectedCollection && collectionContainsPath(selectedCollection, pathname, currentPath)
      ? selectedCollection
      : matchedCollection

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

  // `clip` contains horizontal spill without creating a scroll container,
  // which lets the banner-aware desktop sidebar remain sticky.
  return (
    <SiteNameProvider initialName={identity.name}>
      <div className="thally-docs-root min-h-screen w-full overflow-x-clip bg-background text-foreground">
        <TopBar
          collections={collections}
          activeCollectionId={activeTabId}
          onCollectionChange={(id) => {
            const target = collections.find((collection) => collection.id === id)
            if (!target) return
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
          i18nConfig={i18nConfig ?? null}
          currentLocale={currentLocale}
          currentPath={currentPath}
          navbarConfig={navbarConfig ?? null}
          siteLinks={identity.links}
        />
        <div className={`thally-docs-shell flex min-h-[calc(100dvh-56px)] w-full ${shell.wrapper}`}>
          <Sidebar sections={activeCollection.sections} title={activeCollection.label} />
          <div className="flex min-h-[calc(100dvh-56px)] w-full min-w-0 flex-1 flex-col">
            <main id="main-content" className="thally-docs-main flex-1 py-[34px] pb-24">
              <PageContainer className={layout.pageGap}>{children}</PageContainer>
            </main>
            <Footer
              footerConfig={footerConfig ?? null}
              siteName={identity.name}
              siteLinks={identity.links}
            />
          </div>
        </div>
      </div>
    </SiteNameProvider>
  )
}
