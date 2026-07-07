export function hexToHslString(hex: string) {
  let normalized = hex.replace('#', '')
  if (normalized.length === 3) {
    normalized = normalized
      .split('')
      .map((char) => char + char)
      .join('')
  }

  const bigint = parseInt(normalized, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255

  const rNorm = r / 255
  const gNorm = g / 255
  const bNorm = b / 255
  const max = Math.max(rNorm, gNorm, bNorm)
  const min = Math.min(rNorm, gNorm, bNorm)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)
        break
      case gNorm:
        h = (bNorm - rNorm) / d + 2
        break
      case bNorm:
        h = (rNorm - gNorm) / d + 4
        break
    }
    h /= 6
  }

  const hDeg = Math.round(h * 360)
  const sPct = Math.round(s * 100)
  const lPct = Math.round(l * 100)
  return `${hDeg} ${sPct}% ${lPct}%`
}

export function toHslValue(color: string) {
  if (color.startsWith('#')) return hexToHslString(color)
  return color
}

/**
 * Normalize a user-typed color (hex `#abc` / `#aabbcc`, or `rgb(r, g, b)`) to a
 * canonical lowercase `#rrggbb` string. Returns null for anything unparseable.
 * The admin accent API drops the whole accent unless BOTH light + dark are
 * strict `#...` hex, so every value must pass through here before it's saved.
 */
export function parseColorToHex(input: string): string | null {
  const value = input.trim().toLowerCase()

  if (value.startsWith('#')) {
    let hex = value.slice(1)
    if (/^[0-9a-f]{3}$/.test(hex)) hex = hex.split('').map((c) => c + c).join('')
    if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`
    return null
  }

  const rgb = value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/)
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, parseInt(n, 10)))
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
  }

  return null
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = (
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x]
  ).map((v) => Math.round((v + m) * 255))
  return `#${[r, g, b].map((n) => Math.min(255, Math.max(0, n)).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Derive a dark-mode accent from a light-mode hex: same hue, lifted lightness and
 * eased saturation so the accent reads well on a dark background (e.g. a deep
 * green `#16a34a` → a brighter `#4ade80`-ish). Always returns valid `#rrggbb`.
 */
export function deriveDarkAccent(lightHex: string): string {
  const [h, sPct, lPct] = hexToHslString(lightHex).split(' ')
  const hue = parseInt(h, 10)
  const s = parseInt(sPct, 10) / 100
  const l = parseInt(lPct, 10) / 100
  const newL = Math.min(0.72, Math.max(0.55, l + 0.22))
  const newS = Math.min(0.85, Math.max(0.45, s))
  return hslToHex(hue, newS, newL)
}


