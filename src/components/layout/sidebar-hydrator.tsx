'use client'

import { useEffect } from 'react'
import type { SidebarCollection } from '@/data/docs'
import { useSidebarCollectionsStore } from './sidebar-store'

interface SidebarCollectionsHydratorProps {
  collections: Array<SidebarCollection>
}

export function SidebarCollectionsHydrator({ collections }: SidebarCollectionsHydratorProps) {
  const setCollections = useSidebarCollectionsStore((state) => state.setCollections)

  useEffect(() => {
    setCollections(collections)
  }, [collections, setCollections])

  return null
}

