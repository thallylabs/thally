'use client'

import { Children, isValidElement, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// <Tab> — individual tab panel (only renders its label + children)
// ---------------------------------------------------------------------------

interface TabProps {
  title: string
  children: ReactNode
}

export function Tab({ children }: TabProps) {
  return <>{children}</>
}

// ---------------------------------------------------------------------------
// <Tabs> — wrapper that renders a tab bar and switches between children
// ---------------------------------------------------------------------------

interface TabsProps {
  children: ReactNode
  className?: string
}

export function Tabs({ children, className }: TabsProps) {
  const tabs = Children.toArray(children).filter(
    (child) => isValidElement(child) && (child.type === Tab || (child.props as TabProps).title),
  )

  const [activeIndex, setActiveIndex] = useState(0)

  if (tabs.length === 0) {
    return <>{children}</>
  }

  return (
    <div className={cn('my-6', className)}>
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border/40">
        {tabs.map((tab, index) => {
          const title = isValidElement(tab)
            ? (tab.props as TabProps).title ?? `Tab ${index + 1}`
            : `Tab ${index + 1}`
          const isActive = index === activeIndex

          return (
            <button
              key={index}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={cn(
                'relative px-4 py-2 text-sm font-medium transition',
                isActive
                  ? 'text-foreground'
                  : 'text-foreground/50 hover:text-foreground/80',
              )}
            >
              {title}
              {isActive ? (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />
              ) : null}
            </button>
          )
        })}
      </div>

      {/* Active panel */}
      <div className="pt-4">
        {tabs[activeIndex]}
      </div>
    </div>
  )
}
