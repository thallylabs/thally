'use client'

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { siteConfig } from '@/data/site'

const SiteNameContext = createContext<string | null>(null)
const LogoAvailabilityContext = createContext({ light: false, dark: false })

interface SiteNameProviderProps {
  children: ReactNode
  initialName: string
}

/**
 * Hydrate every client identity consumer from the request-bound server value.
 *
 * The API refresh keeps dashboard edits live, while `initialName` prevents a
 * forked release from flashing the baseline identity on its first paint.
 */
export function SiteNameProvider({ children, initialName }: SiteNameProviderProps) {
  const [name, setName] = useState(initialName)
  const [logoAvailability, setLogoAvailability] = useState({ light: false, dark: false })
  useEffect(() => {
    fetch('/api/site-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (c?.name && typeof c.name === 'string') setName(c.name)
        setLogoAvailability({
          light: c?.logoAvailability?.light === true,
          dark: c?.logoAvailability?.dark === true,
        })
      })
      .catch(() => {})
  }, [])
  return createElement(SiteNameContext.Provider, { value: name },
    createElement(LogoAvailabilityContext.Provider, { value: logoAvailability }, children))
}

/** Only probe configured artwork; missing or unavailable config keeps the default mark. */
export function useLogoAvailability() {
  return useContext(LogoAvailabilityContext)
}

/** The effective site name — request snapshot, refreshed live by the dashboard. */
export function useSiteName(): string {
  return useContext(SiteNameContext) ?? siteConfig.name
}

/**
 * Site name shaped for brand surfaces: leading capital regardless of how the
 * site was created ("sina" → "Sina"). Display-only — configuration, slugs,
 * and metadata keep the owner's original casing.
 */
export function displaySiteName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return trimmed
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}
