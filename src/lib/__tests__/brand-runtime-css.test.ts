/** Runtime branding CSS validation and rendering coverage. */

import { describe, expect, it } from 'vitest'

import { brandRuntimeCss } from '../brand-runtime-css'

describe('brandRuntimeCss', () => {
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
