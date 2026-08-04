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
        'thally-docs-prose prose max-w-none dark:prose-invert',
        className,
      )}
      {...props}
    />
  )
}
