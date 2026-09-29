/** SSR coverage for unlocked defaults, locked theme consumers, and bootstrap ownership. */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Providers } from './providers'
import { useReaderTheme } from '@/components/theme/reader-theme'
import { ThemeSwitch } from '@/components/theme/theme-switch'

vi.mock('nuqs/adapters/next/app', () => ({ NuqsAdapter: ({ children }: { children: ReactNode }) => children }))

function Probe() {
  const theme = useReaderTheme()
  return <span data-mode={theme.resolvedTheme} data-forced={theme.forcedTheme}><ThemeSwitch /></span>
}

describe('reader providers', () => {
  it('retains the established system bootstrap and reader preference key by default', () => {
    const html = renderToStaticMarkup(<Providers><Probe /></Providers>)
    expect(html).toContain('"theme","system"')
    expect(html).toContain('aria-label="Toggle theme"')
    expect(html).not.toContain('type="text/plain"')
  })
  it('uses an owner-selected light default without forcing reader choices', () => {
    const html = renderToStaticMarkup(<Providers appearance={{ default: 'light', showToggle: true }}><Probe /></Providers>)
    expect(html).toContain('"theme","light",null')
    expect(html).toContain('aria-label="Toggle theme"')
  })
  it.each(['light', 'dark'] as const)('exposes enforced %s to image/diagram consumers and hides the switch in SSR', mode => {
    const html = renderToStaticMarkup(<Providers appearance={{ default: mode, showToggle: false }}><Probe /></Providers>)
    expect(html).toContain(`data-mode="${mode}"`)
    expect(html).toContain(`data-forced="${mode}"`)
    expect(html).toContain('type="text/plain"')
    expect(html).not.toContain('Toggle theme')
  })
  it('lets the head bootstrap determine OS appearance without a server light-mode guess', () => {
    const html = renderToStaticMarkup(<Providers appearance={{ default: 'system', showToggle: false }}><Probe /></Providers>)
    expect(html).toContain('data-forced="system"')
    expect(html).toContain('type="text/plain"')
    expect(html).not.toContain('Toggle theme')
  })
})
