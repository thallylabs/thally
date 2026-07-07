import { describe, it, expect } from 'vitest'
import { parseColorToHex, deriveDarkAccent } from '@/lib/colors'

const HEX6 = /^#[0-9a-f]{6}$/

describe('parseColorToHex', () => {
  it('normalizes 6-digit hex to lowercase', () => {
    expect(parseColorToHex('#16A34A')).toBe('#16a34a')
  })
  it('expands 3-digit hex', () => {
    expect(parseColorToHex('#0AF')).toBe('#00aaff')
  })
  it('parses rgb() to hex', () => {
    expect(parseColorToHex('rgb(22, 163, 74)')).toBe('#16a34a')
  })
  it('parses rgba() (ignoring alpha) and clamps out-of-range channels', () => {
    expect(parseColorToHex('rgba(300, 0, 128, 0.5)')).toBe('#ff0080')
  })
  it('trims surrounding whitespace', () => {
    expect(parseColorToHex('  #fff  ')).toBe('#ffffff')
  })
  it('returns null for garbage', () => {
    expect(parseColorToHex('not-a-color')).toBeNull()
    expect(parseColorToHex('#12')).toBeNull()
    expect(parseColorToHex('rgb(1,2)')).toBeNull()
    expect(parseColorToHex('')).toBeNull()
  })
})

describe('deriveDarkAccent', () => {
  // The accent API drops the whole accent unless BOTH light + derived-dark are
  // strict #rrggbb — so the derived value must always be valid hex.
  it('always returns valid #rrggbb across varied inputs', () => {
    for (const hex of ['#16a34a', '#000000', '#ffffff', '#f97316', '#6366f1', '#e11d48', '#334155']) {
      expect(deriveDarkAccent(hex)).toMatch(HEX6)
    }
  })
  it('lifts a deep green toward a brighter dark-mode green', () => {
    const dark = deriveDarkAccent('#16a34a')
    expect(dark).toMatch(HEX6)
    // Lighter than the source (dark-mode accents read brighter on dark bg).
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)
    expect(lum(dark)).toBeGreaterThan(lum('#16a34a'))
  })
})
