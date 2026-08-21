/**
 * Shared linked surfaces for Card, Tile, and their responsive groups.
 * Card and Tile intentionally share semantics while retaining distinct media scale.
 */
import Image from 'next/image'
import type { CSSProperties, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Icon, type ContentIconTone } from '@/components/mdx/content-icon'
import { IntentPrefetchLink } from '@/components/navigation/intent-prefetch-link'
import { cn } from '@/lib/utils'

type CardCallout = 'info' | 'success' | 'warning' | 'danger' | 'note' | 'tip' | 'check'

export interface ContentCardProps {
  title?: string
  href?: string
  icon?: string
  iconType?: 'regular' | 'solid' | 'outline'
  /** Theme tone or any valid CSS color for the icon. */
  iconColor?: ContentIconTone | string
  /** Mintlify-compatible alias for an arbitrary icon color. */
  color?: string
  img?: string
  horizontal?: boolean
  cta?: ReactNode
  arrow?: boolean
  callout?: CardCallout
  /** Mintlify-compatible intent alias. */
  type?: CardCallout
  children?: ReactNode
}

export interface ContentCardGroupProps {
  cols?: number | string
  children: ReactNode
  className?: string
}

const columnClassnames: Record<number, string> = {
  1: 'grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4',
}

const calloutClassnames: Record<CardCallout, string> = {
  info: 'border-sky-300/70 dark:border-sky-500/40',
  success: 'border-emerald-300/70 dark:border-emerald-500/40',
  warning: 'border-amber-300/70 dark:border-amber-500/40',
  danger: 'border-rose-300/70 dark:border-rose-500/40',
  note: 'border-border',
  tip: 'border-emerald-300/70 dark:border-emerald-500/40',
  check: 'border-lime-300/70 dark:border-lime-500/40',
}

function isExternalLink(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

function isSafeLink(href: string): boolean {
  return href.startsWith('#') || (href.startsWith('/') && !href.startsWith('//') && !href.includes('\\')) || /^(https?:|mailto:)/i.test(href)
}

function isSafeImageSource(src: string): boolean {
  return (src.startsWith('/') && !src.startsWith('//') && !src.includes('\\')) || /^https:\/\//i.test(src)
}

function isTone(value?: string): value is ContentIconTone {
  return value === 'neutral' || value === 'accent'
}

interface SharedCardProps extends ContentCardProps {
  kind: 'card' | 'tile'
}

function ContentCardSurface({ kind, title, href, icon, iconType, iconColor, color, img, horizontal = false, cta, arrow, callout, type, children }: SharedCardProps) {
  const resolvedIconColor = color ?? iconColor
  const resolvedCallout = type ?? callout
  const showArrow = arrow ?? Boolean(href)
  const tone = isTone(resolvedIconColor) ? resolvedIconColor : 'site'
  const customIconStyle = resolvedIconColor && !isTone(resolvedIconColor) ? ({ color: resolvedIconColor } as CSSProperties) : undefined
  const content = (
    <article
      className={cn(
        'thally-docs-card group/card relative flex h-full overflow-hidden rounded-[12px] border border-border bg-background p-5 transition-colors duration-150 hover:border-foreground/25',
        horizontal ? 'flex-row items-start gap-4' : 'flex-col',
        resolvedCallout && calloutClassnames[resolvedCallout],
      )}
      data-card-tone={tone}
      data-card-kind={kind}
      data-callout={resolvedCallout}
    >
      {img && isSafeImageSource(img) ? (
        <div className={cn('relative shrink-0 overflow-hidden rounded-lg border border-border/40 bg-muted', horizontal ? 'h-20 w-28' : 'mb-4 w-full', kind === 'tile' && !horizontal && 'h-40')}>
          <Image src={img} alt={title ?? ''} width={1280} height={720} sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw" className={cn('h-full w-full object-cover', kind === 'tile' && 'transition-transform duration-300 group-hover/card:scale-[1.03]')} />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-6 items-center gap-2.5">
          {icon ? (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center" style={customIconStyle}>
              <Icon icon={icon} iconType={iconType} className="thally-content-icon h-[18px] w-[18px]" color={customIconStyle?.color} data-content-icon-tone={tone} />
            </span>
          ) : null}
          {title ? <span className="min-w-0 flex-1 text-base font-medium leading-6 text-foreground">{title}</span> : null}
          {showArrow && !cta ? <ArrowRight className="h-4 w-4 shrink-0 text-foreground/40 transition-transform group-hover/card:translate-x-0.5" aria-hidden="true" /> : null}
        </div>
        {children ? <div className="prose prose-sm mt-1.5 text-foreground/70 dark:prose-invert">{children}</div> : null}
        {cta ? (
          <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-semibold text-accent">
            {cta}<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/card:translate-x-0.5" aria-hidden="true" />
          </span>
        ) : null}
      </div>
    </article>
  )

  if (!href || !isSafeLink(href)) return content
  const external = isExternalLink(href)
  return <IntentPrefetchLink href={href} className="block h-full" target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>{content}</IntentPrefetchLink>
}

/** Render a compact documentation card. */
export function Card(props: ContentCardProps) {
  return <ContentCardSurface kind="card" {...props} />
}

/** Render a media-forward documentation tile. */
export function Tile(props: ContentCardProps) {
  return <ContentCardSurface kind="tile" {...props} />
}

function ContentCardGroup({ cols, children, className, defaultCols }: ContentCardGroupProps & { defaultCols: number }) {
  const parsedCols = typeof cols === 'string' ? Number.parseInt(cols, 10) : cols
  const columnClassName = columnClassnames[parsedCols ?? defaultCols] ?? columnClassnames[defaultCols]
  return <div className={cn('grid grid-cols-1 gap-x-6 gap-y-4', columnClassName, className)}>{children}</div>
}

/** Lay out cards in a responsive grid. */
export function CardGroup(props: ContentCardGroupProps) {
  return <ContentCardGroup {...props} defaultCols={3} />
}

/** Lay out tiles in a responsive grid. */
export function TileGroup(props: ContentCardGroupProps) {
  return <ContentCardGroup {...props} defaultCols={2} />
}
