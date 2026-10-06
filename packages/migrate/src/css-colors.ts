/** Brand colours a Mintlify site sets through `--primary*` custom properties in its own stylesheet. */

export interface CssBrandColors {
  light?: { accent?: string; primary?: string }
  dark?: { accent?: string; primary?: string }
}

export type BrandVars = Partial<Record<'primary' | 'primary-light' | 'primary-dark', string>>

const channel = (value: string): number => Number(value)

/** Space/comma RGB triplet, `rgb()`/`rgba()`, or 3/6-digit hex, as six-digit lowercase hex. */
export function cssColorToHex(raw: string): string | undefined {
  const value = raw.trim().replace(/\s*!important$/i, '')
  if (value.length > 64) return undefined
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1]
  if (hex) return `#${(hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex).toLowerCase()}`
  const rgb = /^(?:rgba?\(\s*)?(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)?$/i.exec(value)
  if (!rgb) return undefined
  const channels = [rgb[1], rgb[2], rgb[3]].map(channel)
  if (channels.some((entry) => entry > 255)) return undefined
  if (value.includes('(') !== value.includes(')')) return undefined
  return `#${channels.map((entry) => entry.toString(16).padStart(2, '0')).join('')}`
}

function stripComments(css: string): string {
  let out = ''
  let index = 0
  while (index < css.length) {
    const open = css.indexOf('/*', index)
    if (open < 0) break
    out += css.slice(index, open)
    const close = css.indexOf('*/', open + 2)
    if (close < 0) return out
    index = close + 2
  }
  return out + css.slice(index)
}

function declarations(body: string, into: BrandVars): void {
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    const name = declaration.slice(0, colon).trim().toLowerCase()
    if (name !== '--primary' && name !== '--primary-light' && name !== '--primary-dark') continue
    const hex = cssColorToHex(declaration.slice(colon + 1))
    if (hex) into[name.slice(2) as keyof BrandVars] = hex
  }
}

/**
 * Reads `--primary`, `--primary-light` and `--primary-dark` from top-level
 * `:root`/`html` and `.dark` rules only; at-rules and other selectors are
 * skipped. One linear pass, so hostile input cannot backtrack.
 */
export function cssBrandVars(css: string): { root: BrandVars; dark: BrandVars } {
  const source = stripComments(css)
  const root: BrandVars = {}
  const dark: BrandVars = {}
  let index = 0
  while (index < source.length) {
    const open = source.indexOf('{', index)
    if (open < 0) break
    let prelude = (source.slice(index, open).split('}').pop() ?? '').trim()
    // `@import …;` and `@charset …;` statements have no block; they precede the next rule.
    while (prelude.startsWith('@') && prelude.includes(';')) prelude = prelude.slice(prelude.indexOf(';') + 1).trim()
    let depth = 1
    let close = open + 1
    for (; close < source.length && depth > 0; close++) {
      if (source[close] === '{') depth++
      else if (source[close] === '}') depth--
    }
    index = close
    if (prelude.startsWith('@')) continue
    for (const selector of prelude.split(',')) {
      const name = selector.trim().toLowerCase()
      const target = name === ':root' || name === 'html' ? root
        : name === '.dark' || name === 'html.dark' || name === ':root.dark' ? dark
          : undefined
      if (target) declarations(source.slice(open + 1, close - 1), target)
    }
  }
  return { root, dark }
}

export function cssBrandColors(css: string): CssBrandColors | undefined {
  return brandColorsFromVars(cssBrandVars(css))
}

/** Resolve variables (merged per variable across files) into accent/button colours. */
export function brandColorsFromVars({ root, dark }: { root: BrandVars; dark: BrandVars }): CssBrandColors | undefined {
  // Mintlify: `--primary` in light mode is the accent and `-dark` the button
  // fill; in dark mode `-light` is the accent and `-dark` falls back to it.
  const result: CssBrandColors = {}
  const lightAccent = root.primary
  const lightButton = root['primary-dark'] ?? root.primary
  if (lightAccent || lightButton) result.light = { ...(lightAccent ? { accent: lightAccent } : {}), ...(lightButton ? { primary: lightButton } : {}) }
  const darkAccent = dark['primary-light'] ?? dark.primary
  const darkButton = dark['primary-dark'] ?? dark['primary-light'] ?? dark.primary
  if (darkAccent || darkButton) result.dark = { ...(darkAccent ? { accent: darkAccent } : {}), ...(darkButton ? { primary: darkButton } : {}) }
  return result.light || result.dark ? result : undefined
}
