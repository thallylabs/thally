/** Regression coverage for navigation snapshots owned by preserved layouts. */

import { beforeEach, describe, expect, it } from 'vitest'
import type { SidebarCollection } from '@/data/docs'
import { useSidebarCollectionsStore } from './sidebar-store'

function collection(id: string): SidebarCollection {
  return { id, label: id, sections: [] }
}

describe('sidebar collection store', () => {
  beforeEach(() => {
    useSidebarCollectionsStore.setState({ collectionsByScope: {} })
  })

  it('keeps root, locale, and API snapshots isolated', () => {
    const { setCollections } = useSidebarCollectionsStore.getState()

    setCollections('default', [collection('documentation')])
    setCollections('locale:fr', [collection('documentation-fr')])
    setCollections('api:management', [collection('api-management')])

    expect(useSidebarCollectionsStore.getState().collectionsByScope).toEqual({
      default: [collection('documentation')],
      'locale:fr': [collection('documentation-fr')],
      'api:management': [collection('api-management')],
    })
  })
})
