'use client'

/** Silently asks this deployment's server to complete its Thally Cloud handshake. */

import { useEffect } from 'react'

export function CloudHandshake() {
  useEffect(() => {
    const connect = () => {
      void fetch('/api/cloud/handshake', {
        method: 'POST',
        cache: 'no-store',
        keepalive: true,
      }).catch(() => {
        // Thally Cloud connectivity must never prevent the documentation UI loading.
      })
    }

    // The handshake is maintenance work, not part of rendering or navigation.
    // Give the browser's critical image/font/script queue the first turn.
    const idleWindow = window as unknown as {
      requestIdleCallback?: (callback: () => void, options: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(connect, { timeout: 2_000 })
      return () => idleWindow.cancelIdleCallback?.(handle)
    }
    const handle = window.setTimeout(connect, 1_000)
    return () => window.clearTimeout(handle)
  }, [])

  return null
}
