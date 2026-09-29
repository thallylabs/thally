'use client'

/** Keep server-rendered brand icons aligned with the reader's effective theme. */
import { useEffect } from 'react'
import { useReaderTheme } from './reader-theme'

/** Preserve metadata's no-JavaScript fallback until the reader theme resolves. */
export function ThemeFavicon() {
  const { resolvedTheme } = useReaderTheme()

  useEffect(() => {
    if (resolvedTheme !== 'light' && resolvedTheme !== 'dark') return

    const href = resolvedTheme === 'dark' ? '/api/brand/favicon?mode=dark' : '/api/brand/favicon'
    const synchronize = () => {
      // Only own the runtime's brand links; leave page-specific, Apple touch,
      // and file-convention icons under Next's metadata ownership.
      for (const link of document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]')) {
        const current = link.getAttribute('href')
        if (current !== '/api/brand/favicon' && current !== '/api/brand/favicon?mode=dark') continue
        if (current !== href) link.setAttribute('href', href)
        if (link.hasAttribute('media')) link.removeAttribute('media')
      }
    }

    synchronize()
    // Metadata can stream after hydration or be replaced on navigation without
    // a theme change. Guarded writes keep observer callbacks from looping.
    const observer = new MutationObserver(synchronize)
    observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'media'] })
    return () => observer.disconnect()
  }, [resolvedTheme])

  return null
}
