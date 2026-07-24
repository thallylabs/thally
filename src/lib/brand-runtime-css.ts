/**
 * Render the request-bound brand tokens delivered by Thally Cloud.
 *
 * The output is intentionally a tiny, validated CSS stylesheet. Managed-site
 * configuration is user-authored data, so every value is allowlisted before it
 * can cross into a CSS identifier, string, URL, or declaration.
 */

import { hexToHslString } from '@thallylabs/core/theme'

export interface RuntimeBrandColorMode {
  primary?: string
  accent?: string
}

export interface RuntimeBrandFont {
  source: 'google' | 'custom'
  family?: string
  weights?: string[]
  path?: string
}

export interface RuntimeBrandingConfig {
  colors?: {
    light?: RuntimeBrandColorMode
    dark?: RuntimeBrandColorMode
  }
  fonts?: {
    body?: RuntimeBrandFont
    heading?: RuntimeBrandFont
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const GOOGLE_FONT_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 -]{0,79}$/
const FONT_WEIGHT = /^(?:[1-9]00)$/
const CUSTOM_FONT_PATH = /^\/?[A-Za-z0-9._/-]+\.(?:woff2|woff)$/i

function relativePublicPath(value: string | undefined): string | null {
  if (!value || !CUSTOM_FONT_PATH.test(value) || value.includes('..')) return null
  const normalized = value.replace(/^\/+/, '').replace(/^public\//, '')
  return normalized ? `/${normalized}` : null
}

function readableForeground(hex: string): '#000000' | '#ffffff' {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((value) => {
    const channel = Number.parseInt(value, 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  return luminance > 0.179 ? '#000000' : '#ffffff'
}

function colorDeclarations(config: RuntimeBrandingConfig): string[] {
  const declarations: string[] = []
  for (const mode of ['light', 'dark'] as const) {
    const colors = config.colors?.[mode]
    if (colors?.primary && HEX_COLOR.test(colors.primary)) {
      declarations.push(
        `--brand-${mode}-primary:${hexToHslString(colors.primary)}`,
        `--brand-${mode}-primary-foreground:${hexToHslString(readableForeground(colors.primary))}`,
      )
    }
    if (colors?.accent && HEX_COLOR.test(colors.accent)) {
      const accent = hexToHslString(colors.accent)
      declarations.push(
        `--brand-${mode}-accent:${accent}`,
        `--brand-${mode}-accent-foreground:${hexToHslString(readableForeground(colors.accent))}`,
        `--brand-${mode}-ring:${accent}`,
      )
    }
  }
  return declarations
}

function googleFontImport(font: RuntimeBrandFont): string | null {
  const family = font.family?.trim()
  if (!family || !GOOGLE_FONT_FAMILY.test(family)) return null
  const weights = [...new Set(font.weights?.filter((weight) => FONT_WEIGHT.test(weight)) ?? [])]
  const selectedWeights = weights.length > 0 ? weights : ['400', '500', '600', '700']
  const familyParam = family.replaceAll(' ', '+')
  return `@import url("https://fonts.googleapis.com/css2?family=${familyParam}:wght@${selectedWeights.join(';')}&display=swap");`
}

function renderFont(role: 'body' | 'heading', font: RuntimeBrandFont): {
  importRule?: string
  faceRule?: string
  declaration?: string
} {
  const variable = role === 'body' ? '--font-sans' : '--font-heading'
  const fallback = 'ui-sans-serif,system-ui,sans-serif'
  if (font.source === 'google') {
    const importRule = googleFontImport(font)
    const family = font.family?.trim()
    if (!importRule || !family) return {}
    return {
      importRule,
      declaration: `${variable}:${JSON.stringify(family)},${fallback}`,
    }
  }

  const path = relativePublicPath(font.path)
  if (!path) return {}
  const family = role === 'body' ? 'Thally Custom Body' : 'Thally Custom Heading'
  const format = path.toLowerCase().endsWith('.woff2') ? 'woff2' : 'woff'
  return {
    faceRule: `@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(path)}) format("${format}");font-display:swap;font-style:normal;font-weight:100 900}`,
    declaration: `${variable}:${JSON.stringify(family)},${fallback}`,
  }
}

/** Build safe CSS for cloud-delivered color and typography overrides. */
export function brandRuntimeCss(config: RuntimeBrandingConfig | null | undefined): string {
  if (!config) return ''
  const imports = new Set<string>()
  const faces: string[] = []
  const declarations = colorDeclarations(config)

  for (const role of ['body', 'heading'] as const) {
    const font = config.fonts?.[role]
    if (!font) continue
    const rendered = renderFont(role, font)
    if (rendered.importRule) imports.add(rendered.importRule)
    if (rendered.faceRule) faces.push(rendered.faceRule)
    if (rendered.declaration) declarations.push(rendered.declaration)
  }

  const rootRule = declarations.length > 0 ? `:root:root{${declarations.join(';')}}` : ''
  return [...imports, ...faces, rootRule].filter(Boolean).join('\n')
}
