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
