'use client'

/** Shared reader policy keeps every theme consumer consistent with enforced modes. */
import { createContext, useContext } from 'react'
import { useTheme } from 'next-themes'

export const ReaderThemeControlsContext = createContext(true)

/** next-themes exposes stored resolvedTheme even when forcedTheme wins visually. */
export function useReaderTheme() {
  const theme = useTheme()
  return {
    ...theme,
    resolvedTheme: theme.forcedTheme === 'system' ? theme.systemTheme : theme.forcedTheme ?? theme.resolvedTheme,
    showToggle: useContext(ReaderThemeControlsContext),
  }
}
