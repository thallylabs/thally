'use client'

/** Collection links keep their complete labels as spacing adapts to the row. */

import type { CSSProperties } from 'react'
import type { SidebarCollection } from '@/data/docs'
import { IntentPrefetchLink } from '@/components/navigation/intent-prefetch-link'
import { cn } from '@/lib/utils'

interface CollectionTabsProps {
  collections: Array<SidebarCollection>
  activeCollectionId: string
  onCollectionChange: (id: string) => void
}

/** Preserve every destination in the initial HTML; CSS handles width changes without a menu or measurement clone. */
export function CollectionTabs({ collections, activeCollectionId, onCollectionChange }: CollectionTabsProps) {
  return (
    <nav
      className="thally-docs-tabs"
      aria-label="Documentation sections"
      style={{ '--collection-count': Math.max(collections.length, 1) } as CSSProperties}
    >
      {collections.map((collection) => {
        const isActive = collection.id === activeCollectionId
        const destination = collection.href ?? collection.sections[0]?.items[0]?.href
        const props = {
          className: cn(
            'thally-nav-tab-item',
            isActive ? 'thally-nav-tab-active border-foreground font-semibold text-foreground' : 'border-transparent font-medium text-foreground/60 hover:text-foreground',
          ),
          'aria-current': isActive ? 'page' as const : undefined,
        }
        // Labels are navigation, not expendable decoration: never ellipsize
        // them. A narrow desktop wraps whole links instead of losing words.
        const label = <span title={collection.label}>{collection.label}</span>
        const onClick = () => onCollectionChange(collection.id)
        return destination
          ? /^https?:\/\//.test(destination)
            ? <a key={collection.id} {...props} href={destination} target="_blank" rel="noreferrer">{label}</a>
            : <IntentPrefetchLink key={collection.id} {...props} href={destination} onClick={onClick}>{label}</IntentPrefetchLink>
          : <button key={collection.id} {...props} type="button" onClick={onClick}>{label}</button>
      })}
    </nav>
  )
}
