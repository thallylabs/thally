/** `--primary*` custom properties in a site's stylesheet become Thally brand colours. */

import { describe, expect, it } from 'vitest'

import { cssBrandColors, cssColorToHex } from '../css-colors.js'

describe('cssColorToHex', () => {
  it('reads triplets, rgb() and hex, and rejects the rest', () => {
    expect(cssColorToHex('200 255 0')).toBe('#c8ff00')
    expect(cssColorToHex('200, 255, 0')).toBe('#c8ff00')
    expect(cssColorToHex('rgb(200 255 0 / 0.5)')).toBe('#c8ff00')
    expect(cssColorToHex('#ABC')).toBe('#aabbcc')
    for (const bad of ['256 0 0', '1 2', 'red', 'rgb(1 2 3', '1 2 3)', 'hsl(1 2% 3%)']) expect(cssColorToHex(bad)).toBeUndefined()
  })
})

describe('cssBrandColors', () => {
  it('maps a dark-mode accent swap to Thally dark colours', () => {
    expect(cssBrandColors('.dark{--primary:200 255 0;--primary-light:200 255 0;--primary-dark:200 255 0}')).toEqual({
      dark: { accent: '#c8ff00', primary: '#c8ff00' },
    })
  })

  it('lets -light drive the dark accent and -dark the dark button', () => {
    expect(cssBrandColors('html.dark{--primary:#111;--primary-light:#222222;--primary-dark:#333}')).toEqual({
      dark: { accent: '#222222', primary: '#333333' },
    })
  })

  it('maps :root overrides to light colours', () => {
    expect(cssBrandColors(':root{--primary:1 2 3;--primary-dark:4 5 6}')).toEqual({
      light: { accent: '#010203', primary: '#040506' },
    })
  })

  it('returns nothing without the variables, with malformed ones, or inside at-rules and other selectors', () => {
    expect(cssBrandColors('a{color:red}')).toBeUndefined()
    expect(cssBrandColors('.dark{--primary:999 0 0}')).toBeUndefined()
    expect(cssBrandColors('@media (min-width:1px){:root{--primary:1 2 3}}@supports (a:b){.dark{--primary:1 2 3}}')).toBeUndefined()
    expect(cssBrandColors('.card{--primary:1 2 3}.dark .card{--primary:1 2 3}')).toBeUndefined()
  })

  it('stays linear on hostile input', () => {
    for (const hostile of ['/*'.repeat(25_000), '{'.repeat(50_000), '}'.repeat(50_000), '.dark{--primary:'.repeat(3_000), `.dark{--primary:${'1 '.repeat(25_000)}}`]) {
      const started = performance.now()
      cssBrandColors(hostile)
      expect(performance.now() - started).toBeLessThan(200)
    }
  })
})

/** Head of OpenRouter's own style.css: a leading `@import`, then `:root`, then a selector-list `.dark` swap. */
const OPENROUTER_STYLE = `/*
 * OpenRouter Docs — Bauhaus theme overrides
 *
 * Custom CSS for Mintlify to align with the bauhaus design system.
 * Uses Mintlify's exposed ID/element selectors for targeted styling.
 *
 * Brand palette:
 *   Ink #03080A   Cloud #FCFCFE   Grape #7624F4
 *   Volt #C8FF00  Coral #FF6849   Royal #035ADE
 */

/* ── Code font: Geist Mono ── */
@import url('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&display=swap');

/*
 * Inverse semantic pair mirrors packages/frontend/components/ui/theme.css.
 * Mintlify is a separate app, so its generated tooltip DOM uses the same
 * light Ink/Cloud and dark Cloud/Ink values through RGB channel variables.
 */
:root {
  --inverse: 3 8 10;
  --inverse-foreground: 252 252 254;
  --tooltip-background: var(--inverse);
  --tooltip-foreground: var(--inverse-foreground);
}

code,
pre,
pre code,
.code-block code,
[class*="code"] code {
  font-family: 'Geist Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
}

/* ── Text selection: accent tint per DESIGN.md ── */
::selection {
  background: rgb(118 36 244 / 0.14);
}

.dark ::selection,
html.dark ::selection {
  background: rgb(200 255 0 / 0.14);
  color: inherit;
}

/* ── Dark-mode accent swap: Volt (#C8FF00 = rgb(200 255 0)) per DESIGN.md ──
 * Mintlify + Tailwind use space-separated RGB: rgb(var(--primary-light) / alpha).
 * Override accent in dark mode from Grape to Volt. */
.dark,
[data-theme="dark"],
html.dark {
  --primary: 200 255 0;
  --primary-light: 200 255 0;
  --primary-dark: 200 255 0;
  --light-primary: 200 255 0;
  --primary-foreground: 3 8 10;
  --inverse: 252 252 254;
  --inverse-foreground: 3 8 10;

  /* ── Dark-mode border: Cloud at 14% per DESIGN.md ── */
  --default-border-color: rgb(252 252 254 / 0.14);
}
`

describe('cssBrandColors on a real stylesheet', () => {
  it('reads the selector-list dark swap that follows a leading @import', () => {
    expect(cssBrandColors(OPENROUTER_STYLE)).toEqual({ dark: { accent: '#c8ff00', primary: '#c8ff00' } })
  })

  it('does not let a leading @import statement hide the rule after it', () => {
    expect(cssBrandColors("@import url('x.css');\n:root{--primary:#0af}")).toEqual({ light: { accent: '#00aaff', primary: '#00aaff' } })
  })
})
