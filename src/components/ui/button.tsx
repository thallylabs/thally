import { Slot } from '@radix-ui/react-slot'
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const VARIANTS: Record<string, string> = {
  solid: 'bg-accent text-accent-foreground shadow-sm hover:bg-accent/90',
  outline: 'border border-border text-foreground hover:bg-muted',
  ghost: 'text-foreground hover:bg-muted',
}

const SIZES: Record<string, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-base',
  icon: 'h-9 w-9',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'solid', size = 'md', asChild, ...props },
  ref,
) {
  const Component = asChild ? Slot : 'button'
  const mergedProps = asChild
    ? props
    : {
        ...props,
        type: props.type ?? 'button',
      }
  return (
    <Component
      ref={ref as never}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--theme-control-radius)] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...mergedProps}
    />
  )
})

