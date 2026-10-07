import { SidebarCollectionsHydrator } from '@/components/layout/sidebar-hydrator'
import { loadSidebarCollections } from '@/data/docs'
import { withApiNavigation } from '@/data/api-reference'
import { getReaderContext } from '@/lib/reader-auth/context'
import { canReaderSeeUnmarkedContent } from '@/lib/reader-auth/page-gate'

interface ApiLayoutProviderProps {
  children: React.ReactNode
  params: Promise<{ slug?: Array<string> }>
}

export default async function ApiLayoutProvider({ children, params }: ApiLayoutProviderProps) {
  const resolved = await params
  const specId = resolved.slug?.[0]
  const reader = await getReaderContext()
  const readerCollections = await loadSidebarCollections(undefined, reader)
  const updatedCollections = canReaderSeeUnmarkedContent(reader)
    ? await withApiNavigation(readerCollections)
    : readerCollections

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
