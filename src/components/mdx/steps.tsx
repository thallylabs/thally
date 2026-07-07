import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// <Steps> — wrapper that resets the CSS counter
// ---------------------------------------------------------------------------

interface StepsProps {
  children: ReactNode
  className?: string
}

export function Steps({ children, className }: StepsProps) {
  return (
    <div
      className={cn('dox-steps relative', className)}
      style={{ counterReset: 'step 0' }}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// <Step> — individual step with numbered circle and connector line
// ---------------------------------------------------------------------------

interface StepProps {
  title: string
  children?: ReactNode
}

export function Step({ title, children }: StepProps) {
  return (
    <div
      className="dox-step relative grid grid-cols-[40px_1fr] gap-x-4 pb-10 last:pb-0"
      style={{ counterIncrement: 'step 1' }}
    >
      {/* Vertical connector line — hidden on last step via CSS */}
      <div className="dox-step-line absolute left-[19px] top-10 bottom-0 w-px bg-border" />

      {/* Numbered circle */}
      <div className="dox-step-number relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-accent/40 bg-background text-sm font-semibold text-accent before:content-[counter(step)]" />

      {/* Step content */}
      <div className="pt-1.5">
        <h3 className="text-xl font-semibold tracking-tight text-foreground">{title}</h3>
        {children ? (
          <div className="prose prose-sm dark:prose-invert mt-3 max-w-none text-foreground/80">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  )
}
