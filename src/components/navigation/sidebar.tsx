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
  showGroupIcons?: boolean
  className?: string
}

export function Sidebar({
  sections,
  title,
  collections = [],
  activeCollectionId,
  onCollectionChange,
  navigationPresentation = { display: 'tabs' },
  showGroupIcons = true,
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
      <div className={cn('sticky top-[var(--docs-header-height,60px)] flex h-[calc(100dvh-var(--docs-header-height,60px))] flex-col', layout.sidebarWidth, layout.sidebarPadding)}>
        <div className="shrink-0 px-1 pt-1">
          {shouldShowSelector ? (
            <CollectionSelector
              collections={collections}
              activeCollectionId={activeCollectionId!}
              onCollectionChange={onCollectionChange!}
            />
          ) : (
            <p className="line-clamp-1 px-2 text-sm font-semibold leading-6 text-foreground">{title}</p>
          )}
        </div>
        <nav className="scrollbar-hide mt-2.5 min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-y-contain pb-5">
          {sections.map((section, index) => {
            const nodes: Array<NavigationNode> = section.nodes
              ?? section.items.map((item) => ({ type: 'page' as const, item }))
            return (
              <div key={section.id ?? `${section.title}-${index}`} className="thally-docs-sidebar-group space-y-2.5">
                {/* A group named after its tab would repeat the label directly
                    beneath the tab heading; the items stand on their own. */}
                {section.title !== title ? (
                  <p className={cn(typography.meta, 'flex items-center gap-2 px-2 text-sm font-semibold normal-case leading-6 tracking-normal text-foreground')}>
                    {showGroupIcons && section.icon ? (
                      <Icon icon={section.icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                    <span className="truncate">{section.title}</span>
                  </p>
                ) : null}
                <div className="space-y-px">
                  <NavigationTree
                    nodes={nodes}
                    pathname={pathname}
                    showGroupIcons={showGroupIcons}
                  />
                </div>
              </div>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}
