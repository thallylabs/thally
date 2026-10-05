'use client'

/** Desktop page navigation without collection headings that duplicate tabs. */

import { usePathname } from 'next/navigation'
import type { NavigationNode, NavigationPresentation, NavigationSection, SidebarCollection, DocsNavigationShortcut } from '@/data/docs'
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
  shortcuts?: Array<DocsNavigationShortcut>
  showGroupIcons?: boolean
  className?: string
}

/** Render page groups without repeating the active collection's tab label. */
export function Sidebar({
  sections,
  title,
  collections = [],
  activeCollectionId,
  onCollectionChange,
  navigationPresentation = { display: 'tabs' },
  shortcuts = [],
  showGroupIcons = true,
  className,
}: SidebarProps) {
  const pathname = usePathname()
  const shouldShowSelector = navigationPresentation.display === 'dropdown'
    && collections.length >= 2
    && Boolean(activeCollectionId && onCollectionChange)
  // A single-collection dropdown has neither tabs nor a usable switcher, so
  // retain its title as the reader's collection context.
  const shouldShowTitle = navigationPresentation.display === 'dropdown'
    && !shouldShowSelector
    && shortcuts.length === 0
  const hasCollectionHeader = shouldShowSelector || shouldShowTitle

  return (
    <aside
      className={cn('thally-docs-sidebar hidden shrink-0 bg-background lg:block', layout.sidebarWidth, className)}
    >
      {/* Stay in the shell's flow so optional site banners reserve their own
          space above the brand, then pin the navigation once they scroll away. */}
      <div className={cn('sticky top-[var(--docs-header-height,60px)] flex h-[calc(100dvh-var(--docs-header-height,60px))] flex-col', layout.sidebarWidth, layout.sidebarPadding)}>
        {/* Dropdown navigation needs collection context; tabs already supply it. */}
        {hasCollectionHeader ? (
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
        ) : null}
        <nav className={cn('scrollbar-hide min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-y-contain pb-5', hasCollectionHeader && 'mt-2.5')}>
          {shortcuts.length > 0 ? (
            <div className="space-y-px border-b border-border/60 pb-4">
              {shortcuts.map((shortcut) => (
                <a key={`${shortcut.label}:${shortcut.href}`} href={shortcut.href}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  target={/^https?:\/\//i.test(shortcut.href) ? '_blank' : undefined}
                  rel={/^https?:\/\//i.test(shortcut.href) ? 'noreferrer' : undefined}>
                  {shortcut.icon ? <Icon icon={shortcut.icon} className="h-4 w-4 shrink-0" /> : null}
                  <span className="truncate">{shortcut.label}</span>
                </a>
              ))}
            </div>
          ) : null}
          {sections.map((section, index) => {
            const nodes: Array<NavigationNode> = section.nodes
              ?? section.items.map((item) => ({ type: 'page' as const, item }))
            return (
              <div key={section.id ?? `${section.title}-${index}`} className="thally-docs-sidebar-group space-y-2.5">
                {/* Keep distinct group headings, but avoid repeating the collection label. */}
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
