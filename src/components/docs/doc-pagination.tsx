import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PrevNextLink } from '@/data/docs'

interface DocPaginationProps {
  prev: PrevNextLink | null
  next: PrevNextLink | null
}

export function DocPagination({ prev, next }: DocPaginationProps) {
  if (!prev && !next) return null

  return (
    <nav className="mt-12 flex items-center justify-between border-t border-border/40 pt-6">
      {prev ? (
        <Link
          href={prev.href}
          className="group flex items-center gap-2 text-sm font-medium text-foreground/70 transition hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4 transition group-hover:-translate-x-0.5" />
          {prev.title}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          href={next.href}
          className="group flex items-center gap-2 text-sm font-medium text-foreground/70 transition hover:text-foreground"
        >
          {next.title}
          <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}
