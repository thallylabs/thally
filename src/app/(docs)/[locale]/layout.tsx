import { SidebarCollectionsHydrator } from '@/components/layout/sidebar-hydrator'
import { getSidebarCollections, getI18nConfig } from '@/data/docs'
import type { NavigationSection } from '@/data/docs'
import { buildApiNavigation } from '@/data/api-reference'

interface LocaleLayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params

  // Guard: if this is not a valid secondary locale (e.g. /quickstart was intercepted as
  // locale="quickstart"), skip locale-aware sidebar hydration to avoid invalid hrefs.
  const i18n = getI18nConfig()
  const isValid = i18n?.locales.some((l) => l.code === locale && l.code !== i18n.defaultLocale) ?? false
  if (!isValid) return <>{children}</>

  const navigation = await buildApiNavigation()
  const apiSections: Array<NavigationSection> = navigation.map((group) => ({
    title: group.title,
    items: group.items.map((item) => ({
      id: item.id,
      title: item.title,
      href: item.href,
      badge: item.badge,
      description: `${item.method} ${item.path}`,
    })),
  }))

  const sidebarCollections = getSidebarCollections(locale)
  const collections = sidebarCollections.map((collection) => {
    if (collection.api) {
      const mdxSections = collection.sections ?? []
      // Prefix API operation hrefs so navigation stays within the locale
      const localizedApiSections = apiSections.map((section) => ({
        ...section,
        items: section.items.map((item) => ({ ...item, href: `/${locale}${item.href}` })),
      }))
      return { ...collection, sections: [...mdxSections, ...localizedApiSections] }
    }
    if (!collection.href && collection.id === 'overview') {
      return { ...collection, href: `/${locale}` }
    }
    // Prefix any direct-link tab hrefs (e.g. Changelog: /changelog → /es/changelog)
    if (collection.href && !/^https?:\/\//i.test(collection.href)) {
      return { ...collection, href: `/${locale}${collection.href}` }
    }
    return collection
  })

  return (
    <>
      <SidebarCollectionsHydrator collections={collections} />
      {children}
    </>
  )
}
