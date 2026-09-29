'use client'

/** Page-scoped locale availability for the persistent documentation header. */

import { useEffect } from 'react'
import { create } from 'zustand'

interface LocaleAvailabilityState {
  availableByPath: Record<string, Array<string>>
  setAvailable: (path: string, locales: Array<string>) => void
}

export const useLocaleAvailability = create<LocaleAvailabilityState>((set) => ({
  availableByPath: {},
  setAvailable: (path, locales) => set((state) => ({
    availableByPath: { ...state.availableByPath, [path]: locales },
  })),
}))

/** Publish the server's actual translated-page set after a route hydrates. */
export function LocaleAvailabilityHydrator({ path, locales }: { path: string; locales: Array<string> }) {
  const setAvailable = useLocaleAvailability((state) => state.setAvailable)
  useEffect(() => {
    setAvailable(path, locales)
  }, [path, locales, setAvailable])
  return null
}
