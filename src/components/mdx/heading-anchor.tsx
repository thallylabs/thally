'use client'

/**
 * Interactive permalink wrapper for MDX section headings.
 * The heading itself is the link, so no extra hash glyph is rendered beside
 * authored content.
 */

import { isValidElement, useCallback, type ReactNode } from 'react'

interface HeadingAnchorProps {
  id: string
  children?: ReactNode
}

function containsLink(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(containsLink)
  if (!isValidElement(node)) return false
  const props = node.props as { children?: ReactNode; href?: unknown }
  // MDX can supply either a native <a> or a link component with href. Both
  // eventually render an anchor, so neither may be nested in our permalink.
  return node.type === 'a' || typeof props.href === 'string' || containsLink(props.children)
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

  if (containsLink(children)) {
    return (
      <>
        <span>{children}</span>
        <a href={`#${id}`} onClick={handleClick} className="sr-only focus:not-sr-only">
          Permalink to this section
        </a>
      </>
    )
  }

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
