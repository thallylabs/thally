'use client'

/** Documentation link that prefetches only after pointer or keyboard intent. */

import Link, { type LinkProps } from 'next/link'
import { useRouter } from 'next/navigation'
import type {
  AriaAttributes,
  FocusEventHandler,
  HTMLAttributeAnchorTarget,
  MouseEventHandler,
  PointerEventHandler,
  ReactNode,
} from 'react'

interface IntentPrefetchLinkProps extends LinkProps {
  children: ReactNode
  className?: string
  target?: HTMLAttributeAnchorTarget
  rel?: string
  'aria-current'?: AriaAttributes['aria-current']
  onClick?: MouseEventHandler<HTMLAnchorElement>
  onFocus?: FocusEventHandler<HTMLAnchorElement>
  onPointerEnter?: PointerEventHandler<HTMLAnchorElement>
}

const warmedHrefs = new Set<string>()

/**
 * Static documentation routes are fully prefetched after reader intent. This
 * follows Next.js's manual-prefetch pattern while deduplicating destinations
 * repeated in the header, sidebar, cards, and footer.
 */
export function IntentPrefetchLink({
  href,
  onFocus,
  onPointerEnter,
  ...props
}: IntentPrefetchLinkProps) {
  const router = useRouter()

  const warmRoute = () => {
    if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return
    if (warmedHrefs.has(href)) return
    warmedHrefs.add(href)
    router.prefetch(href)
  }

  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onPointerEnter={(event) => {
        onPointerEnter?.(event)
        warmRoute()
      }}
      onFocus={(event) => {
        onFocus?.(event)
        warmRoute()
      }}
    />
  )
}
