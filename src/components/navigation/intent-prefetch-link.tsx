'use client'

/**
 * Documentation link that warms complete App Router payloads only after a
 * reader signals intent, without eagerly requesting every sidebar page.
 */

import Link, { type LinkProps } from 'next/link'
import { useRouter } from 'next/navigation'
import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types'
import type {
  AriaAttributes,
  FocusEventHandler,
  HTMLAttributeAnchorTarget,
  MouseEventHandler,
  PointerEventHandler,
  ReactNode,
} from 'react'

const warmedHrefs = new Set<string>()

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

/**
 * Prefetches same-origin documentation routes on hover or keyboard focus.
 * External destinations remain normal links and never trigger router work.
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
    // `FULL` is intentional: AUTO can issue one request per route segment,
    // while a complete payload keeps the eventual click in the route cache.
    router.prefetch(href, {
      kind: PrefetchKind.FULL,
      onInvalidate: () => {
        warmedHrefs.delete(href)
      },
    })
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
