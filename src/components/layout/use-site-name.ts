'use client'

import { useEffect, useState } from 'react'
import { siteConfig } from '@/data/site'

/** The effective site name — build config, overridden live by the dashboard. */
export function useSiteName(): string {
  const [name, setName] = useState(siteConfig.name)
  useEffect(() => {
    fetch('/api/site-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (c?.name && typeof c.name === 'string') setName(c.name)
      })
      .catch(() => {})
  }, [])
  return name
}
