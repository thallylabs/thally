'use client'

import { create } from 'zustand'

interface SidebarCollectionShape {
  id: string
  label: string
  sections: Array<{
    title: string
    items: Array<{
      id: string
      title: string
      href: string
      badge?: string
      description?: string
    }>
  }>
  href?: string
}

interface SidebarCollectionsState {
  collections: Array<SidebarCollectionShape>
  setCollections: (collections: Array<SidebarCollectionShape>) => void
}

export const useSidebarCollectionsStore = create<SidebarCollectionsState>((set) => ({
  collections: [],
  setCollections: (collections) => set({ collections }),
}))

