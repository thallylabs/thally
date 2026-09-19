/** Runtime branding CSS validation and rendering coverage. */

import { describe, expect, it } from 'vitest'

import { brandRuntimeCss } from '../brand-runtime-css'

describe('brandRuntimeCss', () => {
  it('applies independent backgrounds to the full shell in each mode', () => {
    const css = brandRuntimeCss({ colors: { light: { background: '#ffffff' }, dark: { background: '#000000' } } })
    for (const surface of ['background', 'sidebar', 'card']) {
      expect(css).toContain(`--brand-light-${surface}:0 0% 100%`)
      expect(css).toContain(`--brand-dark-${surface}:0 0% 0%`)
    }
    // Background changes must not replace text or brand choices.
    expect(css).not.toContain('foreground')
    expect(css).not.toContain('primary')
  })

  it('preserves repository defaults when backgrounds are omitted or invalid', () => {
    expect(brandRuntimeCss({ colors: { light: {}, dark: { background: '' } } })).toBe('')
    expect(brandRuntimeCss({ colors: { light: { background: '#fff' }, dark: { background: '#000000;}body{display:none' } } })).toBe('')
    const css = brandRuntimeCss({ colors: { dark: { background: '#000000' } } })
    expect(css).not.toContain('--brand-light-')
  })

  it('renders per-theme colors with readable foregrounds', () => {
    expect(
      brandRuntimeCss({
        colors: {
          light: { primary: '#111827', accent: '#0f766e' },
          dark: { primary: '#f8fafc', accent: '#5eead4' },
        },
      }),
    ).toContain(
      '--brand-light-primary:221 39% 11%;--brand-light-primary-foreground:0 0% 100%;--brand-light-accent:175 77% 26%',
    )
    expect(brandRuntimeCss({ colors: { dark: { primary: '#f8fafc' } } })).toContain(
      '--brand-dark-primary-foreground:0 0% 0%',
    )
  })

  it('uses each theme accent for active sidebar items', () => {
    const css = brandRuntimeCss({
      colors: {
        light: { accent: '#5f021e' },
        dark: { accent: '#fbd204' },
      },
    })

    expect(css).toContain('--brand-sidebar-active-bg-light:342 96% 19% / 0.12')
    expect(css).toContain('--brand-sidebar-active-text-light:342 96% 19%')
    expect(css).toContain('--brand-sidebar-active-bg-dark:50 97% 50% / 0.12')
    expect(css).toContain('--brand-sidebar-active-text-dark:50 97% 50%')
  })

  it('loads validated Google and repository-hosted fonts', () => {
    const css = brandRuntimeCss({
      fonts: {
        body: { source: 'google', family: 'IBM Plex Sans', weights: ['400', '600'] },
        heading: { source: 'custom', path: 'public/brand/fonts/heading.woff2' },
      },
    })

    expect(css).toContain('family=IBM+Plex+Sans:wght@400;600')
    expect(css).toContain('--font-sans:"IBM Plex Sans"')
    expect(css).toContain('@font-face{font-family:"Thally Custom Heading"')
    expect(css).toContain('url("/brand/fonts/heading.woff2")')
  })

  it('drops values that could break out of CSS syntax or asset paths', () => {
    const css = brandRuntimeCss({
      colors: { light: { primary: 'red;display:none', accent: '#abc' } },
      fonts: {
        body: { source: 'google', family: 'Inter\";}body{display:none' },
        heading: { source: 'custom', path: '../../secret.woff2' },
      },
    })

    expect(css).toBe('')
  })
})
