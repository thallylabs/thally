import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { BreadcrumbItem } from '@/data/docs'

interface DocBreadcrumbsProps {
  items: Array<BreadcrumbItem>
}

export function DocBreadcrumbs({ items }: DocBreadcrumbsProps) {
  if (items.length < 2) return null

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-foreground/50">
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <span key={index} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="transition hover:text-foreground/80"
              >
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? 'text-foreground/70 font-medium' : ''}>
                {item.label}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
