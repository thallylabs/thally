'use client'

import { usePathname } from 'next/navigation'
import type { NavigationSection } from '@/data/docs'
import { Badge } from '@/components/ui/badge'
import { Icon } from '@/components/mdx/rich-content'
import { layout, typography } from '@/config/layout'
import { cn } from '@/lib/utils'
import { IntentPrefetchLink } from '@/components/navigation/intent-prefetch-link'

interface SidebarProps {
  sections: Array<NavigationSection>
  title: string
  className?: string
}

export function Sidebar({ sections, title, className }: SidebarProps) {
  const pathname = usePathname()

  function isActive(href: string) {
    if (!href || /^https?:\/\//i.test(href)) {
      return false
    }
    const normalizedHref = normalizePath(href)
    const normalizedPath = normalizePath(pathname)
    if (normalizedHref === '/') {
      return normalizedPath === '/'
    }
    const segments = normalizedHref.split('/').filter(Boolean)
    if (segments.length <= 1) {
      return normalizedPath === normalizedHref
    }
    return normalizedPath === normalizedHref || normalizedPath.startsWith(`${normalizedHref}/`)
  }

  return (
    <aside
      className={cn('thally-docs-sidebar hidden shrink-0 border-r border-border bg-background lg:block', layout.sidebarWidth, className)}
    >
      {/* Stay in the shell's flow so optional site banners reserve their own
          space above the brand, then pin the navigation once they scroll away. */}
      <div className={cn('sticky top-12 flex h-[calc(100dvh-48px)] flex-col', layout.sidebarWidth, layout.sidebarPadding)}>
        <div className="shrink-0 px-1 pt-1">
          <p className="line-clamp-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-foreground/38">{title}</p>
        </div>
        <nav className="scrollbar-hide mt-5 min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-y-contain pb-5">
            {sections.map((section) => (
              <div key={section.title} className="space-y-2.5">
                <p className={cn(typography.meta, 'flex items-center gap-1.5 px-1 text-[0.69rem] uppercase tracking-[0.12em] text-foreground/45')}>
                  {section.icon && <Icon icon={section.icon} className="h-3.5 w-3.5 shrink-0 text-foreground/50" />}
                  <span className="truncate">{section.title}</span>
                </p>
                <div className="relative pl-3">
                  <span className="absolute inset-y-0 left-0 w-px bg-border" />
                  <div>
                    {section.items.map((item) => {
                      const active = isActive(item.href)
                      return (
                        <IntentPrefetchLink
                          key={item.id}
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'group relative block px-3 py-[7px] text-left transition',
                            'focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/30',
                            active
                              ? 'bg-transparent text-foreground shadow-none'
                              : 'text-foreground/58 hover:bg-transparent hover:text-foreground',
                          )}
                        >
                          <span
                            className={cn(
                              'thally-sidebar-indicator absolute -left-3 inset-y-0 w-px transition',
                              active ? 'bg-foreground' : 'bg-transparent group-hover:bg-foreground/35',
                            )}
                          />
                          <span
                            className={cn(
                              'flex items-center gap-2 text-[0.85rem] leading-tight',
                              active ? 'font-semibold' : 'font-medium',
                            )}
                          >
                            <span className="line-clamp-2 break-words">{item.title}</span>
                            {item.badge ? <Badge className="shrink-0 text-[10px] uppercase">{item.badge}</Badge> : null}
                          </span>
                        </IntentPrefetchLink>
                      )
                    })}
                  </div>
                </div>
              </div>
            ))}
        </nav>
      </div>
    </aside>
  )
}

function normalizePath(value: string) {
  if (!value) {
    return '/'
  }
  if (value === '/') {
    return '/'
  }
  return value.endsWith('/') ? value.slice(0, -1) : value
}
