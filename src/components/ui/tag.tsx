import { cn } from '@/lib/utils'

const variantStyles = {
  small: '',
  medium: 'rounded-lg px-1.5 ring-1 ring-inset',
}

const colorStyles = {
  accent: {
    small: 'text-accent',
    medium: 'ring-accent/30 dark:ring-accent/30 bg-accent/10 text-accent dark:bg-accent/15',
  },
  sky: {
    small: 'text-sky-500',
    medium:
      'ring-sky-300 bg-sky-400/10 text-sky-500 dark:ring-sky-400/30 dark:bg-sky-400/10 dark:text-sky-400',
  },
  amber: {
    small: 'text-amber-500',
    medium:
      'ring-amber-300 bg-amber-400/10 text-amber-500 dark:ring-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400',
  },
  rose: {
    small: 'text-rose-500',
    medium:
      'ring-rose-200 bg-rose-50 text-rose-500 dark:ring-rose-500/20 dark:bg-rose-400/10 dark:text-rose-400',
  },
  zinc: {
    small: 'text-zinc-400 dark:text-zinc-500',
    medium:
      'ring-zinc-200 bg-zinc-50 text-zinc-500 dark:ring-zinc-500/20 dark:bg-zinc-400/10 dark:text-zinc-400',
  },
}

const valueColorMap: Record<string, keyof typeof colorStyles> = {
  GET: 'accent',
  POST: 'sky',
  PUT: 'amber',
  DELETE: 'rose',
}

interface TagProps {
  children: string
  variant?: keyof typeof variantStyles
  color?: keyof typeof colorStyles
}

export function Tag({ children, variant = 'medium', color }: TagProps) {
  const resolvedColor = color ?? valueColorMap[children] ?? 'accent'
  return (
    <span
      className={cn(
        'font-mono text-[0.625rem] leading-6 font-semibold',
        variantStyles[variant],
        colorStyles[resolvedColor][variant],
      )}
    >
      {children}
    </span>
  )
}

