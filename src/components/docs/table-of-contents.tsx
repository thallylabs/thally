'use client'

import { usePathname } from 'next/navigation'
import { startTransition, useCallback, useEffect, useState } from 'react'
import { layout, typography } from '@/config/layout'
import { cn } from '@/lib/utils'

interface TocItem {
  id: string
  text: string
  level: number
}

// Distance from the top of the viewport (px) at which a heading is considered
// "active". Matches the scroll-mt offset applied to headings.
const ACTIVE_OFFSET = 120

export function TableOfContents() {
  const pathname = usePathname()
  const [items, setItems] = useState<Array<TocItem>>([])
  const [activeId, setActiveId] = useState<string>()

  useEffect(() => {
    function refreshHeadings() {
      const headingElements = Array.from(
        document.querySelectorAll<HTMLElement>('[data-heading]'),
      ).filter((element) => element.getClientRects().length > 0).map((element) => ({
        id: element.id,
        text: element.dataset.heading ?? element.textContent ?? '',
        level: Number(element.dataset.level ?? 2),
      }))
      startTransition(() => setItems(headingElements))
    }

    refreshHeadings()
    window.addEventListener('thally:view-change', refreshHeadings)
    return () => window.removeEventListener('thally:view-change', refreshHeadings)
  }, [pathname])

  useEffect(() => {
    if (items.length === 0) return

    let frame = 0
    function computeActive() {
      const headings = items
        .map((item) => document.getElementById(item.id))
        .filter((el): el is HTMLElement => Boolean(el))
      if (headings.length === 0) return

      let current = headings[0].id
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top - ACTIVE_OFFSET <= 0) {
          current = heading.id
        } else {
          break
        }
      }
      setActiveId(current)
    }

    function onScroll() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(computeActive)
    }

    computeActive()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [items])

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
      const target = document.getElementById(id)
      if (!target) return
      event.preventDefault()
      setActiveId(id)
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      window.history.replaceState(null, '', `#${id}`)
    },
    [],
  )

  if (items.length === 0) return null

  return (
    <aside className={cn('thally-docs-toc sticky top-[82px] max-h-[calc(100dvh-82px)] overflow-y-auto text-sm', layout.tocWidth)}>
      <p className={cn('mb-2.5 font-mono text-[0.68rem] tracking-[0.14em]', typography.meta)}>On this page</p>
      <ul className="border-l border-border">
        {items.map((item) => {
          const isActive = activeId === item.id
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                onClick={(event) => handleClick(event, item.id)}
                className={cn(
                  '-ml-px flex items-center border-l-2 py-1 pr-2 text-left text-[0.83rem] leading-[1.45] transition-colors duration-200 hover:text-foreground',
                  item.level > 2 ? 'pl-7' : 'pl-4',
                  isActive
                    ? 'border-foreground font-semibold text-foreground'
                    : 'border-transparent text-foreground/55',
                )}
              >
                {item.text}
              </a>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
