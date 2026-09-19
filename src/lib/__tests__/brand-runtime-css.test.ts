/** Runtime branding CSS validation and rendering coverage. */

import { describe, expect, it } from 'vitest'
import { hexToHslString } from '@thallylabs/core/theme'

import { brandRuntimeCss } from '../brand-runtime-css'

describe('brandRuntimeCss', () => {
  it('uses the shared image in both modes and allows a dark-only background', () => {
    const shared = brandRuntimeCss({ background: { image: 'public/brand/background-light.png' } })
    expect(shared).toContain('--site-background-light:url("/brand/background-light.png")')
    expect(shared).toContain('--site-background-dark:url("/brand/background-light.png")')
    const dark = brandRuntimeCss({ background: { imageDark: '/brand/background-dark.png' } })
    expect(dark).toContain('--site-background-light:none')
    expect(dark).toContain('--site-background-dark:url("/brand/background-dark.png")')
  })

  it('renders only allowlisted decorations and keeps mode images independent', () => {
    const css = brandRuntimeCss({ background: { image: '/light.png', imageDark: '/dark.webp', decoration: 'grid' } })
    expect(css).toContain('--site-background-dark:url("/dark.webp")')
    expect(css).toContain('--site-background-decoration-size:24px 24px')
    expect(brandRuntimeCss({ background: { decoration: 'gradient' } })).toContain('radial-gradient(ellipse at top left')
    expect(brandRuntimeCss({ background: { image: 'https://x.test/\";}body{display:none}', decoration: 'none' } })).not.toContain('body')
  })
  it('applies independent backgrounds to the full shell in each mode', () => {
    const css = brandRuntimeCss({ colors: { light: { background: '#ffffff' }, dark: { background: '#000000' } } })
    for (const surface of ['background', 'sidebar', 'card']) {
      expect(css).toContain(`--brand-light-${surface}:0 0% 100%`)
      expect(css).toContain(`--brand-dark-${surface}:0 0% 0%`)
    }
    // Secondary text adapts, but main text and brand choices remain authored.
    expect(css).not.toContain('--brand-light-foreground:')
    expect(css).not.toContain('--brand-dark-foreground:')
    expect(css).not.toContain('primary')
  })

  it('harmonizes secondary surfaces with lavender and navy backgrounds', () => {
    const css = brandRuntimeCss({ colors: {
      light: { background: '#F5F3FF', primary: '#171A16', accent: '#171A16' },
      dark: { background: '#0F172A', primary: '#F87171', accent: '#F87171' },
    } })
    const palettes = {
      light: { muted: '#EBE9F5', input: '#E1E0EB', border: '#D8D6E0', 'muted-foreground': '#58575C' },
      dark: { muted: '#1D2537', input: '#272E3F', border: '#313748', 'muted-foreground': '#ADB0B7' },
    }
    for (const mode of ['light', 'dark'] as const) {
      for (const [token, hex] of Object.entries(palettes[mode])) {
        expect(css).toContain(`--brand-${mode}-${token}:${hexToHslString(hex)}`)
      }
    }
    expect(css).toContain(`--brand-light-primary:${hexToHslString('#171A16')}`)
    expect(css).toContain(`--brand-sidebar-active-text-dark:${hexToHslString('#F87171')}`)
  })

  it('uses actual background luminance even when a palette crosses modes', () => {
    const css = brandRuntimeCss({ colors: {
      light: { background: '#000000' }, dark: { background: '#FFFFFF' },
    } })
    expect(css).toContain(`--brand-light-muted:${hexToHslString('#0F0F0F')}`)
    expect(css).toContain(`--brand-dark-muted:${hexToHslString('#F5F5F5')}`)
  })

  it('does not change secondary tokens for accent-only or image-only overrides', () => {
    for (const css of [
      brandRuntimeCss({ colors: { light: { accent: '#171A16' } } }),
      brandRuntimeCss({ background: { image: '/background.png' } }),
    ]) {
      expect(css).not.toMatch(/--brand-(light|dark)-(muted|input|border):/)
    }
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
