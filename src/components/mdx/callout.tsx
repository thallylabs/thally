import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface CalloutProps {
  variant: 'info' | 'warning' | 'error'
  title?: string
  children: ReactNode
}

const variantStyles = {
  info: {
    container:
      'border-accent/30 bg-accent/10 text-foreground dark:border-accent/25 dark:bg-accent/15 dark:text-foreground',
    iconRing: 'bg-accent/15 text-accent dark:bg-accent/20',
  },
  warning: {
    container:
      'border-amber-500/30 bg-amber-500/5 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-50',
    iconRing:
      'bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-200',
  },
  error: {
    container:
      'border-rose-500/30 bg-rose-500/5 text-rose-900 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-50',
    iconRing:
      'bg-rose-500/10 text-rose-600 dark:bg-rose-400/10 dark:text-rose-200',
  },
}

function CalloutIcon({ variant }: { variant: CalloutProps['variant'] }) {
  if (variant === 'warning') {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
        <path
          d="M10 3.5 2.5 16.5h15L10 3.5Z"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    )
  }

  if (variant === 'error') {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
        <path
          d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4v5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="10" cy="13.5" r="0.75" fill="currentColor" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="currentColor" opacity="0.15" />
      <path
        d="M10 6v5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <circle cx="10" cy="13.5" r="0.75" fill="currentColor" />
    </svg>
  )
}

export function Callout({ variant, title, children }: CalloutProps) {
  return (
    <div className={cn('my-6 rounded-2xl border p-4 text-sm leading-6', variantStyles[variant].container)}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex h-8 w-8 items-center justify-center rounded-full',
            variantStyles[variant].iconRing,
          )}
        >
          <CalloutIcon variant={variant} />
        </span>
        <div className="[&>:first-child]:mt-0 [&>:last-child]:mb-0 flex-1 space-y-2">
          {title && <p className="text-sm font-semibold">{title}</p>}
          {children}
        </div>
      </div>
    </div>
  )
}


