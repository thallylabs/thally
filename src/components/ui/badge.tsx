import { cn } from '@/lib/utils'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'outline'
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--theme-badge-radius)] px-2 py-0.5 text-xs font-medium uppercase tracking-wide',
        variant === 'default' ? 'bg-muted text-foreground' : 'border border-border text-foreground/80',
        className,
      )}
      {...props}
    />
  )
}

