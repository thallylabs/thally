/** Builds the locale-prefixed sidebar state shared by localized docs and API pages. */

import { SidebarCollectionsHydrator } from '@/components/layout/sidebar-hydrator'
import { withApiNavigation } from '@/data/api-reference'
import { loadSidebarCollections } from '@/data/docs'

interface LocalizedSidebarHydratorProps {
  locale: string
}

/** Hydrate navigation whose internal links remain inside the requested locale. */
export async function LocalizedSidebarHydrator({
  locale,
}: LocalizedSidebarHydratorProps) {
  const sidebarCollections = await withApiNavigation(await loadSidebarCollections(locale), `/${locale}`)
  const collections = sidebarCollections.map((collection) => {
    // Keep collection destinations source-owned. Inventing a locale-root href
    // for Overview makes its prefix match every page in every other collection.
    if (collection.api && collection.api.navigation !== false) return collection
    if (collection.href && !/^https?:\/\//i.test(collection.href)) {
      return { ...collection, href: `/${locale}${collection.href}` }
    }
    return collection
  })

  return <SidebarCollectionsHydrator collections={collections} scope={`locale:${locale}`} />
}
