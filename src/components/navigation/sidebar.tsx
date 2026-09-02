'use client'

import { usePathname } from 'next/navigation'
import type { NavigationNode, NavigationPresentation, NavigationSection, SidebarCollection } from '@/data/docs'
import { Icon } from '@/components/mdx/rich-content'
import { layout, typography } from '@/config/layout'
import { cn } from '@/lib/utils'
import { NavigationTree } from '@/components/navigation/navigation-tree'
import { CollectionSelector } from '@/components/navigation/collection-selector'

interface SidebarProps {
  sections: Array<NavigationSection>
  title: string
  collections?: Array<SidebarCollection>
  activeCollectionId?: string
  onCollectionChange?: (id: string) => void
  navigationPresentation?: NavigationPresentation
  className?: string
}

export function Sidebar({
  sections,
  title,
  collections = [],
  activeCollectionId,
  onCollectionChange,
  navigationPresentation = { display: 'tabs' },
  className,
}: SidebarProps) {
  const pathname = usePathname()
  const shouldShowSelector = navigationPresentation.display === 'dropdown'
    && collections.length >= 2
    && Boolean(activeCollectionId && onCollectionChange)

  return (
    <aside
      className={cn('thally-docs-sidebar hidden shrink-0 bg-background lg:block', layout.sidebarWidth, className)}
    >
      {/* Stay in the shell's flow so optional site banners reserve their own
          space above the brand, then pin the navigation once they scroll away. */}
      <div className={cn('sticky top-14 flex h-[calc(100dvh-56px)] flex-col', layout.sidebarWidth, layout.sidebarPadding)}>
        <div className="shrink-0 px-1 pt-1">
          {shouldShowSelector ? (
            <CollectionSelector
              collections={collections}
              activeCollectionId={activeCollectionId!}
              onCollectionChange={onCollectionChange!}
            />
          ) : (
            <p className="line-clamp-1 text-xs font-medium leading-4 text-foreground/45">{title}</p>
          )}
        </div>
        <nav className="scrollbar-hide mt-5 min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-y-contain pb-5">
          {sections.map((section, index) => {
            const nodes: Array<NavigationNode> = section.nodes
              ?? section.items.map((item) => ({ type: 'page' as const, item }))
            return (
              <div key={section.id ?? `${section.title}-${index}`} className="space-y-2">
                {/* A group named after its tab would repeat the label directly
                    beneath the tab heading; the items stand on their own. */}
                {section.title !== title ? (
                  <p className={cn(typography.meta, 'flex items-center gap-1.5 px-2 text-xs font-semibold normal-case leading-4 tracking-normal text-foreground/70')}>
                    {section.icon && <Icon icon={section.icon} className="h-3.5 w-3.5 shrink-0 text-foreground/50" />}
                    <span className="truncate">{section.title}</span>
                  </p>
                ) : null}
                <div className="ml-1 border-l border-border/55 pl-1.5">
                  <NavigationTree nodes={nodes} pathname={pathname} />
                </div>
              </div>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}
