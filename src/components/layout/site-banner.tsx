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
    <div className="dox-ink-banner" role="status">
      <div className="dox-ink-banner-inner">
        <span className="dox-ink-banner-dot" aria-hidden />
        <span
          className="dox-ink-banner-content"
          // Banner copy is authored in docs.json by the site owner.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: parseBannerContent(banner.content) }}
        />
        {banner.dismissible ? (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss banner"
            className="dox-ink-banner-dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Convert `[text](url)` → `<a href="url">text</a>` in the banner content string. */
function parseBannerContent(raw: string): string {
  return raw.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
}
