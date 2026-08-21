/**
 * Stable compatibility barrel for Thally's original rich-content module.
 *
 * Focused interactive components live in their own modules so their client
 * boundaries, tests, and contracts stay reviewable. Existing internal imports
 * may continue using this module while new code should prefer the focused file.
 */

import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { ZoomableContent } from '@/components/mdx/zoomable-content'
import { IntentPrefetchLink } from '@/components/navigation/intent-prefetch-link'
import { cn } from '@/lib/utils'

export { Card, CardGroup, Tile, TileGroup } from '@/components/mdx/content-cards'
export { Icon } from '@/components/mdx/content-icon'
export type { IconProps } from '@/components/mdx/content-icon'
export { Badge, Tooltip } from '@/components/mdx/content-inline'
export { Color } from '@/components/mdx/color'
export { Update } from '@/components/mdx/content-metadata'
export {
  InlineRequestExample as RequestExample,
  InlineResponseExample as ResponseExample,
} from '@/components/mdx/examples'
export { ContentPanel as Panel } from '@/components/mdx/panel'
export {
  Terminal as Prompt,
  TerminalInput as PromptUser,
  TerminalOutput as PromptAssistant,
} from '@/components/mdx/prompt'

interface HeroProps {
  title: string
  subtitle?: string
  primaryLabel?: string
  primaryHref?: string
  secondaryLabel?: string
  secondaryHref?: string
}

/** Render the authored landing-page hero used by `mode: home`. */
export function Hero({
  title,
  subtitle,
  primaryLabel,
  primaryHref,
  secondaryLabel,
  secondaryHref,
}: HeroProps) {
  const hasActions = Boolean(primaryHref || secondaryHref)
  return (
    <section className="thally-docs-hero not-prose mb-8 py-7">
      <div className="flex max-w-3xl flex-col items-start text-left">
        <h1 className="max-w-[17ch] text-balance font-heading text-[2rem] font-medium leading-9 tracking-[-0.025em] text-foreground sm:text-4xl sm:leading-10">
          {title}
        </h1>
        {subtitle ? (
          <p className="thally-docs-hero-copy max-w-[56ch] text-pretty text-lg leading-7 text-foreground/70">
            {subtitle}
          </p>
        ) : null}
        {hasActions ? (
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {primaryHref ? (
              <IntentPrefetchLink
                href={primaryHref}
                className="inline-flex items-center gap-2 rounded-[9px] bg-primary px-4 py-2 text-[0.84rem] font-semibold text-primary-foreground transition hover:brightness-125 active:scale-[0.98]"
              >
                {primaryLabel ?? 'Get started'}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </IntentPrefetchLink>
            ) : null}
            {secondaryHref ? (
              <IntentPrefetchLink
                href={secondaryHref}
                className="inline-flex items-center gap-2 rounded-[9px] border border-border bg-background px-4 py-2 text-[0.84rem] font-semibold text-foreground transition hover:border-accent hover:text-foreground active:scale-[0.98]"
              >
                {secondaryLabel ?? 'Learn more'}
              </IntentPrefetchLink>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

interface ColumnsProps {
  cols?: number | string
  children: ReactNode
}

const columnClassnames: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
}

/** Lay out arbitrary MDX children in one to four responsive columns. */
export function Columns({ cols = 2, children }: ColumnsProps) {
  const count = typeof cols === 'string' ? Number.parseInt(cols, 10) : cols
  return <div className={cn('grid grid-cols-1 gap-3', columnClassnames[count] ?? columnClassnames[2])}>{children}</div>
}

interface FrameProps {
  caption?: string
  zoom?: boolean
  children: ReactNode
}

/** Present media in a captioned, optionally zoomable documentation frame. */
export function Frame({ caption, zoom = true, children }: FrameProps) {
  return (
    <figure className="my-6 overflow-hidden rounded-[11px] border border-border bg-muted/40">
      {zoom ? <ZoomableContent><div className="p-5">{children}</div></ZoomableContent> : <div className="p-5">{children}</div>}
      {caption ? <figcaption className="border-t border-border px-5 py-3 text-[0.8rem] leading-[1.55] text-foreground/60">{caption}</figcaption> : null}
    </figure>
  )
}
