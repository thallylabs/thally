'use client'

import { useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { usePathname } from 'next/navigation'
import type { DocsJsonBanner } from '@/data/docs'

interface SiteBannerProps {
  banner: DocsJsonBanner
  defaultLocale?: string
  locales?: Array<string>
}

export interface BannerPreviewProps {
  content: string
  type?: 'info' | 'warning' | 'critical'
  color?: DocsJsonBanner['color']
  dismissible?: boolean
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

function bannerIdentity(banner: DocsJsonBanner): { key: string; revision: string } {
  const content = typeof banner.content === 'string' ? banner.content : JSON.stringify(banner.content)
  const safeId = banner.id?.trim().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80) || 'site'
  return { key: `${STORAGE_KEY}:${safeId}`, revision: banner.revision?.trim().slice(0, 120) || content }
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)
}

function bannerStyle(banner: DocsJsonBanner): CSSProperties | undefined {
  const light = isHexColor(banner.color?.light) ? banner.color.light : undefined
  const dark = isHexColor(banner.color?.dark) ? banner.color.dark : undefined
  if (!light && !dark) return undefined
  return {
    '--thally-banner-light': light,
    '--thally-banner-dark': dark,
  } as CSSProperties
}

function bannerContentForPath(banner: DocsJsonBanner, pathname: string, defaultLocale: string, locales: Array<string>): string {
  if (typeof banner.content === 'string') return banner.content
  const routeLocale = pathname.split('/').filter(Boolean)[0]
  const locale = routeLocale && locales.includes(routeLocale) ? routeLocale : defaultLocale
  return banner.content[locale] ?? banner.content[defaultLocale] ?? Object.values(banner.content)[0] ?? ''
}

function BannerPresentation({ banner, content, onDismiss }: { banner: DocsJsonBanner; content: string; onDismiss?: () => void }) {
  const variant = banner.type ?? banner.variant ?? 'info'
  return (
    <div className="thally-ink-banner" role="status" data-variant={variant} style={bannerStyle(banner)}>
      <div className="thally-ink-banner-inner">
        <span className="thally-ink-banner-dot" aria-hidden />
        <span className="thally-ink-banner-content">{parseBannerContent(content)}</span>
        {onDismiss ? (
          <button type="button" onClick={onDismiss} aria-label="Dismiss banner" className="thally-ink-banner-dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function DismissibleBanner({ banner, content }: { banner: DocsJsonBanner; content: string }) {
  const identity = bannerIdentity(banner)
  const visible = useSyncExternalStore(
    subscribeToDismissal,
    () => {
      try {
        return localStorage.getItem(identity.key) !== identity.revision
      } catch {
        return true
      }
    },
    () => true,
  )

  function dismiss() {
    try {
      localStorage.setItem(identity.key, identity.revision)
      // The native storage event does not fire in the same document that
      // performed the write, so notify this component explicitly.
      window.dispatchEvent(new Event(STORAGE_EVENT))
    } catch {
      // Storage may be unavailable in privacy modes; the banner remains useful.
    }
  }

  if (!visible) return null

  return <BannerPresentation banner={banner} content={content} onDismiss={dismiss} />
}

/** Render a no-JS-safe announcement, adding client state only when dismissible. */
export function SiteBanner({ banner, defaultLocale = 'en', locales = [defaultLocale] }: SiteBannerProps) {
  const pathname = usePathname() || '/'
  const content = bannerContentForPath(banner, pathname, defaultLocale, locales)
  return banner.dismissible
    ? <DismissibleBanner banner={banner} content={content} />
    : <BannerPresentation banner={banner} content={content} />
}

/**
 * Show the production banner treatment inside authored documentation.
 *
 * This intentionally delegates to BannerPresentation so the component guide
 * cannot drift from the site-wide banner that readers actually configure.
 */
export function BannerPreview({ content, type = 'info', color, dismissible = false }: BannerPreviewProps) {
  const [isVisible, setIsVisible] = useState(true)
  const banner: DocsJsonBanner = { content, type, color, dismissible }

  return (
    <figure className="not-prose my-6 overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <figcaption className="flex min-h-10 items-center justify-between border-b border-border px-4 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-foreground/45">
        <span>Site banner preview</span>
        {!isVisible ? (
          <button
            type="button"
            onClick={() => setIsVisible(true)}
            className="rounded-md px-2 py-1 text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            Show again
          </button>
        ) : null}
      </figcaption>
      {isVisible ? (
        <BannerPresentation
          banner={banner}
          content={content}
          onDismiss={dismissible ? () => setIsVisible(false) : undefined}
        />
      ) : (
        <div className="flex min-h-14 items-center justify-center px-4 text-sm text-foreground/45">
          Preview dismissed
        </div>
      )}
    </figure>
  )
}

function safeBannerHref(rawHref: string): string | null {
  if (rawHref.startsWith('#')) return rawHref
  if (rawHref.startsWith('/') && !rawHref.startsWith('//') && !rawHref.includes('\\')) return rawHref
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
        <a key={`${match.index}-${href}`} href={href} rel={/^https?:/.test(href) ? 'noreferrer' : undefined}>
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
