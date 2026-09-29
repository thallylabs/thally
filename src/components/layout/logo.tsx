'use client'

/** Theme-aware brand artwork, bounded without forcing wordmarks into a square. */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useReaderTheme } from '@/components/theme/reader-theme'
import { cn } from '@/lib/utils'
import { displaySiteName, useSiteName } from './use-site-name'

// Stable no-op subscribe for the hydration gate below.
const emptySubscribe = () => () => {}

interface LogoProps {
  className?: string
  showText?: boolean
}

/** Preserve uploaded artwork proportions in both header and mobile navigation. */
export function Logo({ className, showText = true }: LogoProps) {
  const siteName = useSiteName()
  // Show an admin-uploaded logo when one exists; otherwise the default mark +
  // site name. The <img> probes /api/brand/logo and swaps in on load.
  const [customOk, setCustomOk] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // Follow the site theme: dark mode requests the dark variant (the route
  // falls back to the light logo when none is uploaded). next-themes reads
  // localStorage synchronously on the client, so resolvedTheme can differ from
  // the SSR output on the very first render — gate on hydration so the src
  // attribute matches the server HTML, then settle to the real theme.
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)
  const { resolvedTheme } = useReaderTheme()
  const isDark = mounted && resolvedTheme === 'dark'
  const src = isDark ? '/api/brand/logo?mode=dark' : '/api/brand/logo'

  // The <img> is server-rendered, so it can finish loading BEFORE React attaches
  // onLoad (the event never fires). Check completeness on mount to catch that.
  useEffect(() => {
    const img = imgRef.current
    if (img?.complete) setCustomOk(img.naturalWidth > 0)
  }, [])

  return (
    <div className={cn('inline-flex min-w-0 max-w-full items-center gap-2', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={siteName}
        data-custom-logo=""
        onLoad={() => setCustomOk(true)}
        onError={() => setCustomOk(false)}
        // A fixed height gives icons and wordmarks equal visual weight. The
        // width cap contains unusually wide assets; object-fit avoids distortion.
        style={{ height: 28, width: 'auto', maxWidth: 'min(160px, 100%)', objectFit: 'contain', objectPosition: 'left', display: customOk ? 'block' : 'none' }}
      />
      {!customOk ? (
        <>
          {/* The default Thally leaf keeps its exact olive in both modes. A
              site owner's uploaded logo still replaces it above. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/default-logo-light.svg"
            alt=""
            width={28}
            height={28}
            className="shrink-0"
          />
          {showText ? (
            <span className="font-heading text-lg font-semibold tracking-tight text-foreground">{displaySiteName(siteName)}</span>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
