'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import { siteConfig } from '@/data/site'

// Stable no-op subscribe for the hydration gate below.
const emptySubscribe = () => () => {}

interface LogoProps {
  className?: string
  showText?: boolean
}

export function Logo({ className, showText = true }: LogoProps) {
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
  const { resolvedTheme } = useTheme()
  const isDark = mounted && resolvedTheme === 'dark'
  const src = isDark ? '/api/brand/logo?mode=dark' : '/api/brand/logo'

  // The <img> is server-rendered, so it can finish loading BEFORE React attaches
  // onLoad (the event never fires). Check completeness on mount to catch that.
  useEffect(() => {
    const img = imgRef.current
    if (img?.complete) setCustomOk(img.naturalWidth > 0)
  }, [])

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={siteConfig.name}
        onLoad={() => setCustomOk(true)}
        onError={() => setCustomOk(false)}
        style={{ height: 28, width: 'auto', display: customOk ? 'block' : 'none' }}
      />
      {!customOk ? (
        <>
          {/* Default brand mark (public/brand, ships with every scaffold) —
              the Thally olive-leaf SVG, theme-aware (olive on light, pale lime
              on dark); replaced site-wide by an admin upload above. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={isDark ? '/brand/thally-logo-dark.svg' : '/brand/thally-logo-light.svg'}
            alt=""
            width={28}
            height={28}
            className="shrink-0"
          />
          {showText ? (
            <span className="font-heading text-lg font-semibold tracking-tight text-foreground">{siteConfig.name}</span>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
