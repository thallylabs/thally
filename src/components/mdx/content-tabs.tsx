'use client'

import { Children, isValidElement, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
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
  const baseId = useId()

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (activeIndex + step + tabs.length) % tabs.length
    if (!step && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    setActiveIndex(next)
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
  }

  if (tabs.length === 0) {
    return <>{children}</>
  }

  return (
    <div className={cn('my-6', className)}>
      {/* Tab bar */}
      <div role="tablist" onKeyDown={onKeyDown} className="flex gap-1 border-b border-border/40">
        {tabs.map((tab, index) => {
          const title = isValidElement(tab)
            ? (tab.props as TabProps).title ?? `Tab ${index + 1}`
            : `Tab ${index + 1}`
          const isActive = index === activeIndex

          return (
            <button
              key={index}
              type="button"
              role="tab"
              id={`${baseId}-tab-${index}`}
              aria-selected={isActive}
              aria-controls={`${baseId}-panel-${index}`}
              tabIndex={isActive ? 0 : -1}
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

      {/* Every panel is rendered so inactive content stays in the server HTML. */}
      {tabs.map((tab, index) => (
        <div
          key={index}
          role="tabpanel"
          id={`${baseId}-panel-${index}`}
          aria-labelledby={`${baseId}-tab-${index}`}
          hidden={index !== activeIndex}
          className="pt-4"
        >
          {tab}
        </div>
      ))}
    </div>
  )
}
