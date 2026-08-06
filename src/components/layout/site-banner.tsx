'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { DocsJsonBanner } from '@/data/docs'

interface SiteBannerProps {
  banner: DocsJsonBanner
}

const STORAGE_KEY = 'thally-banner-dismissed'
const STORAGE_EVENT = 'thally-banner-storage-change'

function subscribeToDismissal(onStoreChange: () => void): () => void {
  window.addEventListener('storage', onStoreChange)
  window.addEventListener(STORAGE_EVENT, onStoreChange)
  return () => {
    window.removeEventListener('storage', onStoreChange)
    window.removeEventListener(STORAGE_EVENT, onStoreChange)
  }
}

export function SiteBanner({ banner }: SiteBannerProps) {
  const visible = useSyncExternalStore(
    subscribeToDismissal,
    () => !banner.dismissible || localStorage.getItem(STORAGE_KEY) !== banner.content,
    () => false,
  )

  function dismiss() {
    if (banner.dismissible) {
      localStorage.setItem(STORAGE_KEY, banner.content)
      // The native storage event does not fire in the same document that
      // performed the write, so notify this component explicitly.
      window.dispatchEvent(new Event(STORAGE_EVENT))
    }
  }

  if (!visible) return null

  return (
    <div className="thally-ink-banner" role="status">
      <div className="thally-ink-banner-inner">
        <span className="thally-ink-banner-dot" aria-hidden />
        <span className="thally-ink-banner-content">{parseBannerContent(banner.content)}</span>
        {banner.dismissible ? (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss banner"
            className="thally-ink-banner-dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function safeBannerHref(rawHref: string): string | null {
  if (rawHref.startsWith('/') || rawHref.startsWith('#')) return rawHref
  try {
    const url = new URL(rawHref)
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:'
      ? rawHref
      : null
  } catch {
    return null
  }
}

/** Render the banner's limited Markdown-link syntax without injecting HTML. */
export function parseBannerContent(raw: string): Array<ReactNode> {
  const nodes: Array<ReactNode> = []
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = linkPattern.exec(raw)) !== null) {
    if (match.index > cursor) nodes.push(raw.slice(cursor, match.index))
    const href = safeBannerHref(match[2])
    nodes.push(
      href ? (
        <a key={`${match.index}-${href}`} href={href}>
          {match[1]}
        </a>
      ) : (
        match[0]
      ),
    )
    cursor = linkPattern.lastIndex
  }

  if (cursor < raw.length) nodes.push(raw.slice(cursor))
  return nodes
}
