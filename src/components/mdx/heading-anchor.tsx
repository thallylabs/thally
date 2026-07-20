'use client'

/**
 * Interactive permalink wrapper for MDX section headings.
 * The heading itself is the link, so no extra hash glyph is rendered beside
 * authored content.
 */

import { useCallback, type ReactNode } from 'react'

interface HeadingAnchorProps {
  id: string
  children: ReactNode
}

/** Wrap a rendered heading in a permalink that copies its canonical URL. */
export function HeadingAnchor({ id, children }: HeadingAnchorProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const url = `${window.location.origin}${window.location.pathname}#${id}`
      void navigator.clipboard.writeText(url)
      // Still update the hash for scroll behavior
      window.history.replaceState(null, '', `#${id}`)
    },
    [id],
  )

  return (
    <a
      href={`#${id}`}
      onClick={handleClick}
      className="no-underline hover:underline"
    >
      {children}
    </a>
  )
}
