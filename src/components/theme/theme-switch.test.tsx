/** Reader switches disappear in server HTML whenever the owner enforces a mode. */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ReaderThemeControlsContext } from './reader-theme'
import { ThemeSwitch } from './theme-switch'

vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark', forcedTheme: 'light', setTheme: vi.fn() }) }))

describe('ThemeSwitch', () => {
  it('shows a switch by default', () => {
    expect(renderToStaticMarkup(<ThemeSwitch />)).toContain('aria-label="Toggle theme"')
  })
  it('renders no interactive control when locked', () => {
    expect(renderToStaticMarkup(<ReaderThemeControlsContext.Provider value={false}><ThemeSwitch /></ReaderThemeControlsContext.Provider>)).toBe('')
  })
})
