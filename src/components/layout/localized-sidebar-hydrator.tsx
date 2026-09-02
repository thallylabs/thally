/** Builds the locale-prefixed sidebar state shared by localized docs and API pages. */

import { SidebarCollectionsHydrator } from '@/components/layout/sidebar-hydrator'
import { buildApiNavigation } from '@/data/api-reference'
import { loadSidebarCollections, type NavigationSection } from '@/data/docs'

interface LocalizedSidebarHydratorProps {
  locale: string
}

/** Hydrate navigation whose internal links remain inside the requested locale. */
export async function LocalizedSidebarHydrator({
  locale,
}: LocalizedSidebarHydratorProps) {
  const navigation = await buildApiNavigation()
  const apiSections: Array<NavigationSection> = navigation.map((group, index) => ({
    id: `openapi-${index}`,
    title: group.title,
    items: group.items.map((item) => ({
      id: item.id,
      title: item.title,
      href: `/${locale}${item.href}`,
      badge: item.badge,
      description: `${item.method} ${item.path}`,
    })),
  }))

  const sidebarCollections = await loadSidebarCollections(locale)
  const collections = sidebarCollections.map((collection) => {
    if (collection.api && collection.api.navigation !== false) {
      return {
        ...collection,
        sections: [...(collection.sections ?? []), ...apiSections],
      }
    }
    if (!collection.href && collection.id === 'overview') {
      return { ...collection, href: `/${locale}` }
    }
    if (collection.href && !/^https?:\/\//i.test(collection.href)) {
      return { ...collection, href: `/${locale}${collection.href}` }
    }
    return collection
  })

  return <SidebarCollectionsHydrator collections={collections} scope={`locale:${locale}`} />
}
