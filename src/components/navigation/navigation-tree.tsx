'use client'

/** Recursive navigation renderer shared by desktop and mobile sidebars. */

import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { NavigationGroup, NavigationNode } from '@/data/docs'
import { Badge } from '@/components/ui/badge'
import { Icon } from '@/components/mdx/rich-content'
import { IntentPrefetchLink } from '@/components/navigation/intent-prefetch-link'
import { cn } from '@/lib/utils'

interface NavigationTreeProps {
  nodes: Array<NavigationNode>
  pathname: string
  onNavigate?: () => void
  mobile?: boolean
}

function normalizePath(value: string) {
  if (!value || value === '/') return '/'
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function matchesPath(href: string, pathname: string) {
  if (!href || /^https?:\/\//i.test(href)) return false
  const normalizedHref = normalizePath(href)
  const normalizedPath = normalizePath(pathname)
  if (normalizedHref === '/') return normalizedPath === '/'
  return normalizedPath === normalizedHref || normalizedPath.startsWith(`${normalizedHref}/`)
}

function groupContainsPath(group: NavigationGroup, pathname: string): boolean {
  return group.nodes.some((node) => node.type === 'page'
    ? matchesPath(node.item.href, pathname)
    : groupContainsPath(node.group, pathname))
}

function NavigationGroupBranch({
  group,
  pathname,
  onNavigate,
  mobile,
  depth,
  path,
}: NavigationTreeProps & { group: NavigationGroup; depth: number; path: string }) {
  const hasActivePath = groupContainsPath(group, pathname)
  const [isManuallyOpen, setIsManuallyOpen] = useState(false)
  const [closedActivePath, setClosedActivePath] = useState<string | null>(null)
  // A newly active route opens its ancestors automatically. Remembering the
  // exact route a reader closed keeps the disclosure responsive without
  // preventing a later child route from revealing itself.
  const isOpen = isManuallyOpen || (hasActivePath && closedActivePath !== pathname)

  return (
    <div className="thally-sidebar-group">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => {
          if (isOpen) {
            setIsManuallyOpen(false)
            setClosedActivePath(hasActivePath ? pathname : null)
            return
          }
          setIsManuallyOpen(true)
          setClosedActivePath(null)
        }}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md py-1 text-left text-foreground/65 transition hover:text-foreground',
          mobile ? 'px-2 text-sm font-semibold' : 'px-2 text-[0.8rem] font-medium',
        )}
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isOpen && 'rotate-90')}
          aria-hidden="true"
        />
        {group.icon ? (
          <Icon icon={group.icon} className="h-3.5 w-3.5 shrink-0 text-foreground/50" />
        ) : null}
        <span className="min-w-0 truncate">{group.title}</span>
      </button>
      {isOpen ? (
        <div className="ml-3 border-l border-border/65 pl-2">
          <NavigationNodes
            nodes={group.nodes}
            pathname={pathname}
            onNavigate={onNavigate}
            mobile={mobile}
            depth={depth + 1}
            path={path}
          />
        </div>
      ) : null}
    </div>
  )
}

function NavigationNodes({
  nodes,
  pathname,
  onNavigate,
  mobile = false,
  depth = 0,
  path = 'root',
}: NavigationTreeProps & { depth?: number; path?: string }) {
  return nodes.map((node, index) => {
    const nodePath = `${path}-${index}`
    if (node.type === 'group') {
      return (
        <NavigationGroupBranch
          key={`${node.group.id}-${nodePath}`}
          group={node.group}
          nodes={node.group.nodes}
          pathname={pathname}
          onNavigate={onNavigate}
          mobile={mobile}
          depth={depth}
          path={nodePath}
        />
      )
    }

    const active = matchesPath(node.item.href, pathname)
    return (
      <IntentPrefetchLink
        key={`${node.item.id}-${nodePath}`}
        href={node.item.href}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
        className={cn(
          'group relative block rounded-md px-2 text-left transition-colors duration-150 focus:outline-none',
          mobile ? 'py-1.5 text-sm' : 'py-1 text-[0.8rem] leading-5',
          active
            ? 'bg-muted/70 font-semibold text-foreground'
            : 'font-medium text-foreground/60 hover:bg-muted/40 hover:text-foreground',
        )}
      >
        <span className="flex min-h-5 items-center gap-2">
          <span className="line-clamp-2 break-words">{node.item.title}</span>
          {node.item.badge ? <Badge className="shrink-0 text-[10px] uppercase">{node.item.badge}</Badge> : null}
        </span>
        {mobile && node.item.description ? (
          <span className="mt-0.5 block text-xs font-normal text-foreground/55">
            {node.item.description}
          </span>
        ) : null}
      </IntentPrefetchLink>
    )
  })
}

/** Render page and group nodes without flattening authored nesting or order. */
export function NavigationTree(props: NavigationTreeProps) {
  return <NavigationNodes {...props} />
}
