'use client'

/** Reader theme policy with an OS subscription for locked system appearance. */
import { useSyncExternalStore } from 'react'
import { ThemeProvider } from 'next-themes'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { ReaderThemeControlsContext } from '@/components/theme/reader-theme'
import { ThemeFavicon } from '@/components/theme/theme-favicon'
import type { SiteAppearance } from '@/lib/site-appearance'

const darkQuery = '(prefers-color-scheme: dark)'
function subscribeSystemTheme(callback: () => void) {
  const media = window.matchMedia(darkQuery)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}
const systemTheme = () => window.matchMedia(darkQuery).matches ? 'dark' : 'light'
const serverTheme = () => 'system'

interface ProvidersProps {
  children: React.ReactNode
  appearance?: Required<SiteAppearance>
}

/** Preserve reader choices only while the site's switch is available. */
export function Providers({ children, appearance = { default: 'system', showToggle: true } }: ProvidersProps) {
  const preferredSystemTheme = useSyncExternalStore(subscribeSystemTheme, systemTheme, serverTheme)
  const forcedTheme = appearance.showToggle ? undefined : appearance.default === 'system' ? preferredSystemTheme : appearance.default
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={appearance.default}
      forcedTheme={forcedTheme}
      enableSystem
      // Locked modes never consult a previously saved reader choice. Their
      // prepaint script lives in <head>; disabling next-themes' bootstrap avoids
      // overwriting it with a server-guessed OS preference before hydration.
      storageKey={appearance.showToggle ? 'theme' : 'thally-locked-appearance'}
      scriptProps={appearance.showToggle ? undefined : { type: 'text/plain' }}
    >
      <ReaderThemeControlsContext.Provider value={appearance.showToggle}>
        <ThemeFavicon />
        <NuqsAdapter>{children}</NuqsAdapter>
      </ReaderThemeControlsContext.Provider>
    </ThemeProvider>
  )
}
