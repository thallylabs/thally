'use client'

/** Accessible collection switcher for Mintlify-style dropdown navigation. */

import { useRef } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { SidebarCollection } from '@/data/docs'
import { Icon } from '@/components/mdx/rich-content'
import { IntentPrefetchLink } from '@/components/navigation/intent-prefetch-link'
import { cn } from '@/lib/utils'

interface CollectionSelectorProps {
  collections: Array<SidebarCollection>
  activeCollectionId: string
  onCollectionChange: (id: string) => void
  compact?: boolean
}
function landingHref(collection: SidebarCollection) {
  return collection.href ?? collection.sections[0]?.items[0]?.href ?? '/'
}

/** Preserve a source product/dropdown switcher instead of coercing it to tabs. */
export function CollectionSelector({
  collections,
  activeCollectionId,
  onCollectionChange,
  compact = false,
}: CollectionSelectorProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const activeCollection = collections.find((collection) => collection.id === activeCollectionId)
    ?? collections[0]

  if (!activeCollection || collections.length < 2) return null

  return (
    <details ref={detailsRef} className="thally-collection-selector group/selector relative">
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center rounded-lg border border-border/70 bg-background text-left transition hover:bg-muted/35 [&::-webkit-details-marker]:hidden',
          compact ? 'w-full gap-2 px-3 py-2' : 'w-full gap-2.5 px-3 py-2.5',
        )}
      >
        {activeCollection.icon ? (
          <Icon icon={activeCollection.icon} className="h-4 w-4 shrink-0 text-foreground/65" />
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.82rem] font-semibold text-foreground">
            {activeCollection.label}
          </span>
          {!compact && activeCollection.description ? (
            <span className="mt-0.5 block truncate text-[0.68rem] text-foreground/45">
              {activeCollection.description}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-foreground/50 transition-transform group-open/selector:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="absolute inset-x-0 top-[calc(100%+6px)] z-50 space-y-1 rounded-xl border border-border bg-background p-1.5 shadow-xl">
        {collections.map((collection) => {
          const isActive = collection.id === activeCollection.id
          const href = landingHref(collection)
          return (
            <IntentPrefetchLink
              key={collection.id}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                onCollectionChange(collection.id)
                detailsRef.current?.removeAttribute('open')
              }}
              className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-muted/55"
            >
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                {isActive ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : collection.icon ? (
                  <Icon icon={collection.icon} className="h-3.5 w-3.5 text-foreground/55" />
                ) : null}
              </span>
              <span className="min-w-0">
                <span className="block text-[0.8rem] font-semibold text-foreground">
                  {collection.label}
                </span>
                {collection.description ? (
                  <span className="mt-0.5 block text-[0.68rem] leading-4 text-foreground/50">
                    {collection.description}
                  </span>
                ) : null}
              </span>
            </IntentPrefetchLink>
          )
        })}
      </div>
    </details>
  )
}
