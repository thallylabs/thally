/** Timeline metadata plus the stable Color compatibility export. */

import type { ReactNode } from 'react'
import { Link as LinkIcon } from 'lucide-react'
import { UpdateArticle } from '@/components/mdx/update-article'
import { Badge } from '@/components/mdx/content-inline'
import { normalizeTags } from '@/lib/update-filters'
import { cn } from '@/lib/utils'
// Shared with the changelog feeds and MCP `list_changes`, so feed links land on this entry.
import { updateAnchorId } from '@thallylabs/core/slugify'
export { Color } from '@/components/mdx/color'

export interface UpdateProps {
  label?: string
  date?: string
  id?: string
  title?: ReactNode
  description?: ReactNode
  tags?: string[] | string
  children?: ReactNode
  className?: string
}

/** Render a linkable release entry on a continuous visual timeline. */
export function Update({ label, date, id, title, description, tags, children, className }: UpdateProps) {
  const anchorId = updateAnchorId({ id, label, date })
  const normalizedTags = normalizeTags(tags)

  return (
    <UpdateArticle id={anchorId} className={cn('not-prose group/update relative my-0 border-l border-border pb-10 pl-7 last:pb-0', className)} tags={normalizedTags}>
      <span className="absolute -left-[5px] top-2 h-2.5 w-2.5 rounded-full border-2 border-background bg-accent ring-1 ring-border" aria-hidden="true" />
      {(label || date || title || normalizedTags.length) ? (
        <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {title ? <h3 className="m-0 w-full text-lg font-semibold text-foreground">{title}</h3> : null}
          {label ? <span className="text-xs font-semibold text-accent">{label}</span> : null}
          {date ? <time dateTime={/^\d{4}-\d{2}-\d{2}/.test(date) ? date : undefined} className="text-sm text-foreground/50">{date}</time> : null}
          {normalizedTags.map((tag) => <Badge key={tag} variant="outline" size="sm">{tag}</Badge>)}
          {anchorId ? <a href={`#${anchorId}`} aria-label={`Link to ${label ?? 'update'}`} className="ml-auto rounded p-1 text-foreground/0 transition group-hover/update:text-foreground/40 focus:text-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><LinkIcon className="h-3.5 w-3.5" aria-hidden="true" /></a> : null}
          {description ? <p className="m-0 w-full text-sm leading-6 text-foreground/65">{description}</p> : null}
        </header>
      ) : null}
      <div className="prose prose-sm text-foreground/80 dark:prose-invert">{children}</div>
    </UpdateArticle>
  )
}
