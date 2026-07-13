'use client'

/** Silently asks this deployment's server to complete its Thally Cloud handshake. */

import { useEffect } from 'react'

export function CloudHandshake() {
  useEffect(() => {
    void fetch('/api/cloud/handshake', {
      method: 'POST',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {
      // Thally Cloud connectivity must never prevent the documentation UI loading.
    })
  }, [])

  return null
}
