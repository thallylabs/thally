'use client'

/**
 * Reads the handoff token from the URL fragment, removes it from the address
 * bar and history immediately, and exchanges it for a reader session.
 */

import { useEffect, useState } from 'react'

export function JwtCallback() {
  const [hasFailed, setHasFailed] = useState(false)

  useEffect(() => {
    // The page's parse-time script has normally captured and stripped the
    // fragment already; reading the hash remains the fallback.
    const handoff = window as Window & { __thallyReaderHandoff?: string }
    const token = handoff.__thallyReaderHandoff || window.location.hash.replace(/^#/, '')
    delete handoff.__thallyReaderHandoff
    const redirect = new URLSearchParams(window.location.search).get('redirect') ?? '/'
    // Drop the token from the visible URL and the history entry before any
    // network round-trip, so it cannot be bookmarked, shared, or restored.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    const exchange = async () => {
      if (!token) throw new Error('missing token')
      const response = await fetch('/api/reader/jwt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, redirect }),
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('rejected')
      const body = (await response.json()) as { redirect?: unknown }
      // The server already validated this as a same-origin path.
      const destination = typeof body.redirect === 'string' && body.redirect.startsWith('/') && !body.redirect.startsWith('//') ? body.redirect : '/'
      window.location.replace(destination)
    }
    exchange().catch(() => setHasFailed(true))
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center px-4 text-center">
      {hasFailed ? (
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Sign-in failed</h1>
          <p className="mt-2 text-sm text-muted-foreground">The sign-in link was invalid or has expired.</p>
          {/* A document navigation: the sign-in route redirects off-site, which client routing cannot follow. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="mt-6 inline-block text-sm underline" href="/api/reader/login">Try again</a>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" role="status">Signing you in…</p>
      )}
    </main>
  )
}
