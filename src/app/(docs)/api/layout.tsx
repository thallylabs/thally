import { SidebarCollectionsHydrator } from '@/components/layout/sidebar-hydrator'
import { loadSidebarCollections } from '@/data/docs'
import { withApiNavigation } from '@/data/api-reference'

interface ApiLayoutProviderProps {
  children: React.ReactNode
  params: Promise<{ slug?: Array<string> }>
}

export default async function ApiLayoutProvider({ children, params }: ApiLayoutProviderProps) {
  const resolved = await params
  const specId = resolved.slug?.[0]
  const updatedCollections = await withApiNavigation(await loadSidebarCollections())

  return (
    <>
      <SidebarCollectionsHydrator
        collections={updatedCollections}
        scope={`api:${specId ?? 'default'}`}
      />
      {children}
    </>
  )
}
