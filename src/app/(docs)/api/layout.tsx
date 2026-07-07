import { SidebarCollectionsHydrator } from '@/components/layout/sidebar-hydrator'
import { getSidebarCollections } from '@/data/docs'
import type { NavigationSection } from '@/data/docs'
import { buildApiNavigation } from '@/data/api-reference'

interface ApiLayoutProviderProps {
  children: React.ReactNode
  params: Promise<{ slug?: Array<string> }>
}

export default async function ApiLayoutProvider({ children, params }: ApiLayoutProviderProps) {
  const resolved = await params
  const specId = resolved.slug?.[0]
  const navigation = await buildApiNavigation(specId)
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

  const collections = getSidebarCollections()
  const updatedCollections = collections.map((collection) => {
    if (!collection.api) return collection
    const mdxSections = collection.sections ?? []
    return { ...collection, sections: [...mdxSections, ...apiSections] }
  })

  return (
    <>
      <SidebarCollectionsHydrator collections={updatedCollections} />
      {children}
    </>
  )
}

