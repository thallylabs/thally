'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface HeadingAnchorProps {
  id: string
  children: ReactNode
}

export function HeadingAnchor({ id, children }: HeadingAnchorProps) {
  const [copied, setCopied] = useState(false)

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const url = `${window.location.origin}${window.location.pathname}#${id}`
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      // Still update the hash for scroll behavior
      window.history.replaceState(null, '', `#${id}`)
    },
    [id],
  )

  return (
    <a
      href={`#${id}`}
      onClick={handleClick}
      className="group/anchor no-underline hover:underline"
    >
      {children}
      <span
        className={cn(
          'ml-2 inline-block text-foreground/20 transition group-hover/anchor:text-accent/60',
          copied && 'text-accent',
        )}
        aria-hidden
      >
        {copied ? '✓' : '#'}
      </span>
    </a>
  )
}
