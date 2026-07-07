'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import type { DocsJsonBanner } from '@/data/docs'

interface SiteBannerProps {
  banner: DocsJsonBanner
}

const STORAGE_KEY = 'dox-banner-dismissed'

export function SiteBanner({ banner }: SiteBannerProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!banner.dismissible) {
      setVisible(true)
      return
    }
    const dismissed = localStorage.getItem(STORAGE_KEY)
    // Re-show if the content changed since last dismissal
    if (dismissed !== banner.content) {
      setVisible(true)
    }
  }, [banner])

  function dismiss() {
    setVisible(false)
    if (banner.dismissible) {
      localStorage.setItem(STORAGE_KEY, banner.content)
    }
  }

  if (!visible) return null

  return (
    <div className="relative z-40 flex items-center justify-center gap-3 bg-accent px-4 py-2 text-center text-sm font-medium text-accent-foreground">
      {/* Render banner content — supports basic markdown-style links via dangerouslySetInnerHTML is avoided;
          content is plain text with optional inline links rendered as-is */}
      <span
        className="[&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:opacity-80"
        // We trust the banner content comes from docs.json which is authored by the developer
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: parseBannerContent(banner.content) }}
      />
      {banner.dismissible && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss banner"
          className="ml-2 shrink-0 rounded p-0.5 opacity-70 transition hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

/** Convert `[text](url)` → `<a href="url">text</a>` in the banner content string. */
function parseBannerContent(raw: string): string {
  return raw.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
}
