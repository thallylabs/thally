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
  /** Mintlify accepts either an icon name or authored inline SVG/JSX. */
  icon?: string | ReactNode
  iconType?: 'regular' | 'solid' | 'outline'
  /** Theme tone or any valid CSS color for the icon. */
  iconColor?: ContentIconTone | string
  /** Mintlify-compatible alias for an arbitrary icon color. */
  color?: string
  img?: string
  horizontal?: boolean
  cta?: ReactNode
  /** Show a directional arrow in the top-right corner. Off by default, as in Mintlify. */
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

function ContentCardSurface({ kind, title, href, icon, iconType, iconColor, color, img, horizontal = false, cta, arrow = false, callout, type, children }: SharedCardProps) {
  const resolvedIconColor = color ?? iconColor
  const resolvedCallout = type ?? callout
  const tone = isTone(resolvedIconColor) ? resolvedIconColor : 'site'
  const customIconStyle = resolvedIconColor && !isTone(resolvedIconColor) ? ({ color: resolvedIconColor } as CSSProperties) : undefined
  const showImage = Boolean(img && isSafeImageSource(img))

  // Stacked cards read top to bottom (icon, title, copy) like Mintlify's Card;
  // horizontal cards keep the icon beside the title so the row stays compact.
  const iconNode = icon ? (
    <span className="thally-docs-card-icon flex h-6 w-6 shrink-0 items-center justify-center" style={customIconStyle}>
      {typeof icon === 'string'
        ? <Icon icon={icon} iconType={iconType} className="thally-content-icon h-6 w-6" color={customIconStyle?.color} data-content-icon-tone={tone} />
        : icon}
    </span>
  ) : null
  const titleNode = title ? (
    <span className={cn('thally-docs-card-title block min-w-0 font-heading text-base font-semibold leading-6 text-foreground', !horizontal && iconNode && 'mt-4')}>{title}</span>
  ) : null

  // The radius is a literal on purpose. Tailwind's `rounded-2xl` maps to
  // `--theme-radius-lg`, which the `sharp` and `minimal` presets shrink to 4px
  // and 0; cards have always kept their own rounding regardless of the preset.
  const content = (
    <article
      className={cn(
        'thally-docs-card group/card relative flex h-full overflow-hidden rounded-[16px] border border-border bg-background transition-colors duration-150 hover:border-accent',
        horizontal ? 'flex-row items-start gap-4 px-6 py-5' : 'flex-col',
        resolvedCallout && calloutClassnames[resolvedCallout],
      )}
      data-card-tone={tone}
      data-card-kind={kind}
      data-card-layout={horizontal ? 'horizontal' : 'stacked'}
      data-card-arrow={arrow ? '' : undefined}
      data-callout={resolvedCallout}
    >
      {showImage ? (
        <div className={cn('relative shrink-0 overflow-hidden bg-muted', horizontal ? 'h-20 w-28 rounded-lg border border-border/40' : cn('w-full', kind === 'tile' ? 'h-44' : 'aspect-[16/9]'))}>
          <Image src={img as string} alt={title ?? ''} width={1280} height={720} sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw" className={cn('h-full w-full object-cover', kind === 'tile' && 'transition-transform duration-300 group-hover/card:scale-[1.03]')} />
        </div>
      ) : null}
      <div className={cn('flex min-w-0 flex-1 flex-col', !horizontal && 'px-6 py-5', arrow && (horizontal ? 'pr-4' : 'pr-10'))}>
        {horizontal ? (
          <div className="flex min-h-6 items-center gap-3">
            {iconNode}
            {titleNode}
          </div>
        ) : (
          <>
            {iconNode}
            {titleNode}
          </>
        )}
        {children ? <div className={cn('thally-docs-card-body prose text-foreground/70 dark:prose-invert', (iconNode || titleNode) && 'mt-1')}>{children}</div> : null}
        {cta ? (
          <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-semibold text-accent">
            {cta}<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/card:translate-x-0.5" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      {arrow ? <ArrowRight className="thally-docs-card-arrow absolute right-5 top-5 h-4 w-4 text-foreground/40 transition group-hover/card:translate-x-[3px] group-hover/card:text-accent" aria-hidden="true" /> : null}
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
  return <div className={cn('grid grid-cols-1 gap-4', columnClassName, className)}>{children}</div>
}

/** Lay out cards in a responsive grid. */
export function CardGroup(props: ContentCardGroupProps) {
  return <ContentCardGroup {...props} defaultCols={2} />
}

/** Lay out tiles in a responsive grid. */
export function TileGroup(props: ContentCardGroupProps) {
  return <ContentCardGroup {...props} defaultCols={2} />
}
