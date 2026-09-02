'use client'

import { useLayoutEffect } from 'react'
import type { SidebarCollection } from '@/data/docs'
import { useSidebarCollectionsStore } from './sidebar-store'

interface SidebarCollectionsHydratorProps {
  collections: Array<SidebarCollection>
  scope?: string
}

export function SidebarCollectionsHydrator({
  collections,
  scope = 'default',
}: SidebarCollectionsHydratorProps) {
  const setCollections = useSidebarCollectionsStore((state) => state.setCollections)

  // Layouts are preserved during App Router transitions. Install the incoming
  // route snapshot before paint and key it so a parent layout can never race a
  // locale or OpenAPI child into the wrong sidebar.
  useLayoutEffect(() => {
    setCollections(scope, collections)
  }, [collections, scope, setCollections])

  return null
}
