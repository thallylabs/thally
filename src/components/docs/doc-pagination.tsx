import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PrevNextLink } from '@/data/docs'
import { IntentPrefetchLink } from '@/components/navigation/intent-prefetch-link'

interface DocPaginationProps {
  prev: PrevNextLink | null
  next: PrevNextLink | null
}

export function DocPagination({ prev, next }: DocPaginationProps) {
  if (!prev && !next) return null

  return (
    <nav className="mt-12 flex items-center justify-between border-t border-border/40 pt-6">
      {prev ? (
        <IntentPrefetchLink
          href={prev.href}
          className="group flex items-center gap-2 text-sm font-medium text-foreground/70 transition hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4 transition group-hover:-translate-x-0.5" />
          {prev.title}
        </IntentPrefetchLink>
      ) : (
        <span />
      )}
      {next ? (
        <IntentPrefetchLink
          href={next.href}
          className="group flex items-center gap-2 text-sm font-medium text-foreground/70 transition hover:text-foreground"
        >
          {next.title}
          <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </IntentPrefetchLink>
      ) : (
        <span />
      )}
    </nav>
  )
}
