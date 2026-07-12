'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'

// Stable no-op subscribe for the hydration gate below.
const emptySubscribe = () => () => {}

/**
 * The site mark used across the admin chrome (sidebar workspace tile, login
 * card). Prefers the admin-uploaded logo and falls back to the bundled default
 * brand mark (public/brand — the Thally logo until the user replaces it).
 * Theme-aware and hydration-safe: dark resolves only after mount.
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)
  const { resolvedTheme } = useTheme()
  const dark = mounted && resolvedTheme === 'dark'

  const [customOk, setCustomOk] = useState(true)
  const imgRef = useRef<HTMLImageElement>(null)
  const src = customOk
    ? `/api/brand/logo${dark ? '?mode=dark' : ''}`
    : dark
      ? '/brand/thally-logo-dark.svg'
      : '/brand/thally-logo-light.svg'

  // The <img> is server-rendered, so it can finish (and fail) BEFORE React
  // attaches onError — the event never fires and the broken probe sticks.
  // Check completeness on mount to catch that (same guard as layout/logo.tsx).
  useEffect(() => {
    const img = imgRef.current
    if (img?.complete) setCustomOk(img.naturalWidth > 0)
  }, [])

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setCustomOk(false)}
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
    />
  )
}
