'use client'

/** Header collections adapt to their actual available width, keeping every destination reachable. */

import { useEffect, useRef, useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ChevronDown } from 'lucide-react'
import type { SidebarCollection } from '@/data/docs'
import { IntentPrefetchLink } from '@/components/navigation/intent-prefetch-link'
import { cn } from '@/lib/utils'

interface CollectionTabsProps {
  collections: Array<SidebarCollection>
  activeCollectionId: string
  onCollectionChange: (id: string) => void
}

/** Render full tabs when they fit, or a keyboard-operable menu when other header controls need space. */
export function CollectionTabs({ collections, activeCollectionId, onCollectionChange }: CollectionTabsProps) {
  const containerRef = useRef<HTMLElement>(null)
  const measurementRef = useRef<HTMLDivElement>(null)
  // Start compact so server-rendered navigation cannot overflow before hydration.
  const [isOverflowing, setIsOverflowing] = useState(true)

  useEffect(() => {
    const container = containerRef.current
    const measurement = measurementRef.current
    if (!container || !measurement) return

    const measure = () => setIsOverflowing(measurement.getBoundingClientRect().width > container.clientWidth)
    measure()
    // Observe both sides: locale/CTA widths, translated labels, and font loading
    // can change the fit independently of the viewport size.
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    observer.observe(measurement)
    return () => observer.disconnect()
  }, [collections, activeCollectionId])

  function renderCollection(collection: SidebarCollection, inMenu: boolean) {
    const isActive = collection.id === activeCollectionId
    const destination = collection.href ?? collection.sections[0]?.items[0]?.href
    const className = inMenu
      ? cn('block w-full rounded-md px-3 py-2 text-left text-sm [overflow-wrap:anywhere] data-[focus]:bg-muted', isActive && 'bg-muted font-semibold')
      : cn(
          'thally-nav-tab-item group relative flex h-full shrink-0 items-center whitespace-nowrap border-b-2 px-[11px] pt-px text-left text-[0.88rem] font-medium transition-colors',
          isActive ? 'thally-nav-tab-active border-foreground font-semibold text-foreground' : 'border-transparent text-foreground/60 hover:text-foreground',
        )
    const props = { className, 'aria-current': isActive ? 'page' as const : undefined }
    const onClick = () => onCollectionChange(collection.id)
    const content = destination
      ? /^https?:\/\//.test(destination)
        ? <a {...props} href={destination} target="_blank" rel="noreferrer">{collection.label}</a>
        : <IntentPrefetchLink {...props} href={destination} onClick={onClick}>{collection.label}</IntentPrefetchLink>
      : <button {...props} type="button" onClick={onClick}>{collection.label}</button>

    return inMenu ? <MenuItem key={collection.id}>{content}</MenuItem> : <span key={collection.id} className="contents">{content}</span>
  }

  return (
    <nav ref={containerRef} className="thally-docs-tabs relative flex h-full min-w-0 flex-1 items-center" aria-label="Documentation sections">
      {/* A clipped, inert copy measures natural tab widths even while the menu
          is shown. It never contributes offscreen overflow or duplicate links. */}
      <div aria-hidden="true" inert className="pointer-events-none invisible absolute inset-0 overflow-hidden">
        <div ref={measurementRef} className="flex h-full w-max items-center gap-4">
          {collections.map((collection) => (
            <span key={collection.id} className={cn('shrink-0 whitespace-nowrap px-[11px] text-[0.88rem] font-medium', collection.id === activeCollectionId && 'font-semibold')}>
              {collection.label}
            </span>
          ))}
        </div>
      </div>
      {isOverflowing ? (
        <Menu>
          <MenuButton className="inline-flex h-9 max-w-full items-center gap-1.5 rounded-lg px-2 text-sm font-medium hover:bg-muted" aria-label="Documentation sections">
            <span className="truncate">Sections</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </MenuButton>
          <MenuItems anchor="bottom start" className="z-50 max-h-[min(28rem,70dvh)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-background p-1.5 text-foreground shadow-lg [--anchor-gap:8px]">
            {collections.map((collection) => renderCollection(collection, true))}
          </MenuItems>
        </Menu>
      ) : (
        <div className="flex h-full items-center gap-4">{collections.map((collection) => renderCollection(collection, false))}</div>
      )}
    </nav>
  )
}
