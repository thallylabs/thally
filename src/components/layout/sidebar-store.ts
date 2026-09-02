'use client'

/** Route-scoped navigation snapshots used by preserved App Router layouts. */

import { create } from 'zustand'
import type { SidebarCollection } from '@/data/docs'

interface SidebarCollectionsState {
  collectionsByScope: Record<string, Array<SidebarCollection>>
  setCollections: (scope: string, collections: Array<SidebarCollection>) => void
}

export const useSidebarCollectionsStore = create<SidebarCollectionsState>((set) => ({
  collectionsByScope: {},
  setCollections: (scope, collections) => set((state) => ({
    collectionsByScope: { ...state.collectionsByScope, [scope]: collections },
  })),
}))
