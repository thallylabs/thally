'use client'

/** Theme-aware brand artwork, bounded without forcing wordmarks into a square. */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useReaderTheme } from '@/components/theme/reader-theme'
import { cn } from '@/lib/utils'
import { displaySiteName, useLogoAvailability, useSiteName } from './use-site-name'

// Stable no-op subscribe for the hydration gate below.
const emptySubscribe = () => () => {}

interface LogoProps {
  className?: string
  showText?: boolean
}

/** Preserve uploaded artwork proportions in both header and mobile navigation. */
export function Logo({ className, showText = true }: LogoProps) {
  const siteName = useSiteName()
  const logoAvailability = useLogoAvailability()
  // Track the loaded URL so changing mode cannot display a failed replacement
  // or keep an earlier mode's load state after its artwork is removed.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
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
  const hasCustomLogo = logoAvailability[isDark ? 'dark' : 'light']
  const customOk = hasCustomLogo && loadedSrc === src

  // A cached image can complete before its load handler runs. Inspect the
  // active source whenever configuration or the reader mode changes.
  // The default mark can be missing too (a site that pruned public/brand):
  // drop it rather than show a broken-image icon; the site name stays.
  const defaultRef = useRef<HTMLImageElement>(null)
  const [defaultOk, setDefaultOk] = useState(true)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      const img = imgRef.current
      if (img?.complete) setLoadedSrc(img.naturalWidth > 0 ? src : null)
      const fallback = defaultRef.current
      if (fallback?.complete && fallback.naturalWidth === 0) setDefaultOk(false)
    })
    return () => { cancelled = true }
  }, [src, hasCustomLogo])

  return (
    <div className={cn('inline-flex min-w-0 max-w-full items-center gap-2', className)}>
      {hasCustomLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          ref={imgRef}
          src={src}
          alt={siteName}
          data-custom-logo=""
          onLoad={() => setLoadedSrc(src)}
          onError={() => setLoadedSrc(null)}
          // A fixed height gives icons and wordmarks equal visual weight. The
          // width cap contains unusually wide assets; object-fit avoids distortion.
          style={{ height: 28, width: 'auto', maxWidth: 'min(160px, 100%)', objectFit: 'contain', objectPosition: 'left', display: customOk ? 'block' : 'none' }}
        />
      ) : null}
      {!customOk ? (
        <>
          {/* The default Thally leaf keeps its exact olive in both modes. A
              site owner's uploaded logo still replaces it above. */}
          {defaultOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={defaultRef}
              src="/brand/default-logo-light.svg"
              alt=""
              width={28}
              height={28}
              className="shrink-0"
              onError={() => setDefaultOk(false)}
            />
          ) : null}
          {showText ? (
            <span className="font-heading text-lg font-semibold tracking-tight text-foreground">{displaySiteName(siteName)}</span>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
