'use client'

import type React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { NavigationSection } from '@/data/docs'
import { Badge } from '@/components/ui/badge'
import { Icon } from '@/components/mdx/rich-content'
import { layout, typography } from '@/config/layout'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/layout/logo'
import { useSiteName } from '@/components/layout/use-site-name'

interface SidebarProps {
  sections: Array<NavigationSection>
  title: string
  className?: string
}

export function Sidebar({ sections, title, className }: SidebarProps) {
  const siteName = useSiteName()
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
      className={cn('hidden shrink-0 border-r border-border/80 bg-background lg:block', layout.sidebarWidth, className)}
    >
      <div className={cn('fixed top-0 flex h-screen flex-col', layout.sidebarWidth, layout.sidebarPadding)}>
        <div className="flex shrink-0 flex-col gap-3 px-1 pt-2">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/30"
          >
            <Logo showText={false} className="shrink-0" />
            <span className="text-sm font-semibold text-foreground">{siteName} Docs</span>
          </Link>
        </div>
        <div className="shrink-0 px-1 pt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-foreground/40 line-clamp-1">{title}</p>
        </div>
        <nav className="mt-6 min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-y-contain pb-4">
            {sections.map((section) => (
              <div key={section.title} className="space-y-3">
                <p className={cn(typography.meta, 'flex items-center gap-1.5 px-1 uppercase tracking-wide text-foreground/70')}>
                  {section.icon && <Icon icon={section.icon} className="h-3.5 w-3.5 shrink-0 text-foreground/50" />}
                  <span className="truncate">{section.title}</span>
                </p>
                <div className="relative pl-4">
                  <span className="absolute inset-y-0 left-1 w-px rounded-full bg-border/70" />
                  <div className="space-y-1">
                    {section.items.map((item) => {
                      const active = isActive(item.href)
                      const activeStyles = active
                        ? {
                            backgroundColor: `hsl(var(--sidebar-active-bg))`,
                            color: `hsl(var(--sidebar-active-text))`,
                          }
                        : undefined
                      return (
                        <Link
                          key={item.id}
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'group relative block px-3 py-2 text-left transition',
                            'rounded-[var(--theme-sidebar-item-radius)]',
                            'focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/30',
                            active
                              ? 'text-foreground shadow-none'
                              : 'text-foreground/70 hover:bg-muted/40 hover:text-foreground',
                          )}
                          style={activeStyles}
                        >
                          <span
                            className={cn(
                              'thally-sidebar-indicator absolute -left-3 inset-y-0 w-px rounded-full transition',
                              active ? 'bg-accent' : 'bg-transparent group-hover:bg-accent/40',
                            )}
                            style={{ opacity: 'var(--theme-sidebar-indicator-opacity, 1)' } as React.CSSProperties}
                          />
                          <span
                            className={cn(
                              'flex items-center gap-2 text-sm leading-tight',
                              active ? 'font-semibold' : 'font-medium',
                            )}
                          >
                            <span className="line-clamp-2 break-words">{item.title}</span>
                            {item.badge ? <Badge className="shrink-0 text-[10px] uppercase">{item.badge}</Badge> : null}
                          </span>
                        </Link>
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

