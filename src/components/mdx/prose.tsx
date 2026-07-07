import type { ComponentPropsWithoutRef, ElementType } from 'react'

import { cn } from '@/lib/utils'

type ProseProps<T extends ElementType> = {
  as?: T
  className?: string
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className'>

export function Prose<T extends ElementType = 'div'>({
  as,
  className,
  ...props
}: ProseProps<T>) {
  const Component = as ?? 'div'

  return (
    <Component
      className={cn(
        'prose dark:prose-invert [html_:where(&>*)]:mx-auto [html_:where(&>*)]:max-w-2xl lg:[html_:where(&>*)]:mx-[calc(50%-min(50%,var(--container-lg)))] lg:[html_:where(&>*)]:max-w-3xl',
        className,
      )}
      {...props}
    />
  )
}

