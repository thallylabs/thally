/** Inline labels and accessible explanatory popovers for authored MDX. */
'use client'

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/mdx/content-icon'

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline'
export type BadgeSize = 'xs' | 'sm' | 'md' | 'lg'
export type BadgeColor = 'gray' | 'blue' | 'cyan' | 'green' | 'lime' | 'yellow' | 'amber' | 'orange' | 'red' | 'rose' | 'purple'

export interface BadgeProps {
  variant?: BadgeVariant
  color?: BadgeColor
  size?: BadgeSize
  rounded?: boolean
  shape?: 'rounded' | 'pill'
  icon?: ReactNode | string
  iconType?: 'regular' | 'solid' | 'outline'
  stroke?: boolean
  disabled?: boolean
  className?: string
  children?: ReactNode
}

const badgeVariantStyles: Record<BadgeVariant, string> = {
  default: 'border-border/60 bg-muted text-foreground',
  success: 'border-green-200 bg-green-50 text-green-800 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300',
  danger: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300',
  info: 'border-accent/30 bg-accent/10 text-accent dark:bg-accent/15',
  outline: 'border-border bg-transparent text-foreground/75',
}

const badgeColorStyles: Record<BadgeColor, string> = {
  gray: 'border-border/70 bg-muted text-foreground/75',
  blue: 'border-blue-300/60 bg-blue-50 text-blue-800 dark:border-blue-500/35 dark:bg-blue-500/15 dark:text-blue-300',
  cyan: 'border-cyan-300/60 bg-cyan-50 text-cyan-800 dark:border-cyan-500/35 dark:bg-cyan-500/15 dark:text-cyan-300',
  green: 'border-green-300/60 bg-green-50 text-green-800 dark:border-green-500/35 dark:bg-green-500/15 dark:text-green-300',
  lime: 'border-lime-300/70 bg-lime-50 text-lime-900 dark:border-lime-400/40 dark:bg-lime-400/15 dark:text-lime-300',
  yellow: 'border-yellow-300/70 bg-yellow-50 text-yellow-900 dark:border-yellow-500/35 dark:bg-yellow-500/15 dark:text-yellow-300',
  amber: 'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-300',
  orange: 'border-orange-300/70 bg-orange-50 text-orange-900 dark:border-orange-500/35 dark:bg-orange-500/15 dark:text-orange-300',
  red: 'border-red-300/70 bg-red-50 text-red-900 dark:border-red-500/35 dark:bg-red-500/15 dark:text-red-300',
  rose: 'border-rose-300/70 bg-rose-50 text-rose-900 dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-300',
  purple: 'border-purple-300/60 bg-purple-50 text-purple-800 dark:border-purple-500/35 dark:bg-purple-500/15 dark:text-purple-300',
}

const badgeSizeStyles: Record<BadgeSize, string> = { xs: 'px-1.5 py-0 text-[0.62rem]', sm: 'px-1.5 py-0 text-[0.68rem]', md: 'px-2 py-0.5 text-xs', lg: 'px-2.5 py-1 text-sm' }

/** Render a semantic inline status or category label. */
export function Badge({ variant = 'default', color, size = 'md', rounded = true, shape, icon, iconType, stroke = false, disabled = false, className, children }: BadgeProps) {
  const iconNode = typeof icon === 'string' ? <Icon icon={icon} iconType={iconType} className="h-[1em] w-[1em]" /> : icon
  const shapeClass = shape === 'pill' ? 'rounded-full' : shape === 'rounded' || rounded ? 'rounded-[var(--theme-badge-radius)]' : 'rounded-sm'
  return (
    <span
      aria-disabled={disabled || undefined}
      className={cn(
        'inline-flex items-center gap-1 border font-medium leading-5',
        shapeClass,
        color ? badgeColorStyles[color] : badgeVariantStyles[variant],
        stroke && 'bg-transparent',
        disabled && 'opacity-45 grayscale',
        badgeSizeStyles[size],
        className,
      )}
    >
      {iconNode}{children}
    </span>
  )
}

export interface TooltipProps {
  tip?: ReactNode
  headline?: ReactNode
  cta?: ReactNode
  href?: string
  children?: ReactNode
}

function isSafeLink(href: string): boolean {
  return href.startsWith('#') || (href.startsWith('/') && !href.startsWith('//') && !href.includes('\\')) || /^(https?:|mailto:)/i.test(href)
}

interface TooltipPosition {
  isBelow: boolean
  shiftX: number
}

const TOOLTIP_GAP = 8
const TOOLTIP_VIEWPORT_PADDING = 12

/**
 * Add a keyboard- and pointer-accessible explanatory popover to inline text.
 * The surface floats without reflowing authored content and corrects its
 * position at viewport edges so the full explanation remains reachable.
 */
export function Tooltip({ tip, headline, cta, href, children }: TooltipProps) {
  const tooltipId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<TooltipPosition>({ isBelow: false, shiftX: 0 })

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    const surface = surfaceRef.current
    if (!trigger || !surface) return

    const triggerRect = trigger.getBoundingClientRect()
    const surfaceWidth = surface.offsetWidth
    const surfaceHeight = surface.offsetHeight
    const centeredLeft = triggerRect.left + triggerRect.width / 2 - surfaceWidth / 2
    const maximumLeft = Math.max(TOOLTIP_VIEWPORT_PADDING, window.innerWidth - TOOLTIP_VIEWPORT_PADDING - surfaceWidth)
    const clampedLeft = Math.min(Math.max(centeredLeft, TOOLTIP_VIEWPORT_PADDING), maximumLeft)
    const availableBelow = window.innerHeight - triggerRect.bottom
    const isBelow = triggerRect.top < surfaceHeight + TOOLTIP_GAP && availableBelow >= surfaceHeight + TOOLTIP_GAP
    const shiftX = clampedLeft - centeredLeft

    setPosition((current) => current.isBelow === isBelow && Math.abs(current.shiftX - shiftX) < 0.5
      ? current
      : { isBelow, shiftX })
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
    }
  }, [updatePosition])

  return (
    <span className="group/tooltip relative inline-flex align-baseline" onPointerEnter={updatePosition} onFocus={updatePosition}>
      <button ref={triggerRef} type="button" aria-describedby={tooltipId} className="cursor-pointer border-0 bg-transparent p-0 font-inherit text-inherit underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        {children}
      </button>
      <span
        ref={surfaceRef}
        id={tooltipId}
        role="tooltip"
        data-tooltip-surface=""
        data-tooltip-placement={position.isBelow ? 'bottom' : 'top'}
        style={{ marginLeft: position.shiftX }}
        className={cn(
          'pointer-events-none invisible absolute left-1/2 z-50 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm font-normal leading-5 text-foreground opacity-0 shadow-lg transition duration-150 group-hover/tooltip:pointer-events-auto group-hover/tooltip:visible group-hover/tooltip:opacity-100 group-focus-within/tooltip:pointer-events-auto group-focus-within/tooltip:visible group-focus-within/tooltip:opacity-100',
          position.isBelow
            ? 'top-full mt-2 before:absolute before:inset-x-0 before:bottom-full before:h-2 before:content-[""]'
            : 'bottom-full mb-2 before:absolute before:inset-x-0 before:top-full before:h-2 before:content-[""]',
        )}
      >
        {headline ? <strong className="mb-0.5 block font-semibold text-foreground">{headline}</strong> : null}
        {tip ? <span className="block text-foreground/70">{tip}</span> : null}
        {cta && href && isSafeLink(href) ? <a href={href} className="mt-1.5 inline-flex cursor-pointer items-center gap-1 font-semibold text-accent">{cta}<ArrowUpRight className="h-3 w-3" aria-hidden="true" /></a> : null}
      </span>
    </span>
  )
}
