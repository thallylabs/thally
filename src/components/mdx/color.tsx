/** Server compound API for copyable Color palettes. */

import type { ReactNode } from 'react'
import { ColorItemClient, type ColorItemProps } from '@/components/mdx/color-item'
import { cn } from '@/lib/utils'

export interface ColorProps extends ColorItemProps {
  variant?: 'compact' | 'table'
  children?: ReactNode
}

export interface ColorRowProps {
  title?: string
  children?: ReactNode
  className?: string
}

function ColorItem(props: ColorItemProps) {
  return <ColorItemClient {...props} />
}

function ColorRow({ title, children, className }: ColorRowProps) {
  return (
    <section className={cn('not-prose my-4', className)}>
      {title ? <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
    </section>
  )
}

function ColorRoot({ children, variant = 'compact', ...props }: ColorProps) {
  if (!children) return <ColorItem {...props} />
  return (
    <div className={cn('not-prose my-5', variant === 'table' ? 'space-y-5 rounded-xl border border-border px-4 py-1' : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4')} data-color-variant={variant}>
      {children}
    </div>
  )
}

/** Compound palette API that also preserves `<Color hex name />`. */
export const Color = Object.assign(ColorRoot, { Item: ColorItem, Row: ColorRow })

