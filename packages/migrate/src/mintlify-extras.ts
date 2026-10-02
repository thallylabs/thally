/**
 * Mintlify-only helpers: access gating signals, site-wide CSS/JS/font assets,
 * and appearance settings. Kept apart from the generic repository walk so the
 * rules that decide what is published (and what is quarantined) are auditable
 * in one place.
 */

import { extname } from 'node:path'

import { normalizeAssetPath } from './path.js'
import type { MigrationDocsConfig, MigrationWarning } from './types.js'

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

const PUBLIC_FALSE_STRINGS = new Set(['false', 'no', 'off', '0'])

/**
 * `public: false` as a boolean or a falsy word/number (`"false"`, `no`, `off`,
 * `0`). Failing closed on those forms: a value someone typed to hide a page
 * must never be read as "no restriction" (the original is quarantined, not lost).
 */
function isPublicFalse(value: unknown): boolean {
  return value === false || value === 0 || (typeof value === 'string' && PUBLIC_FALSE_STRINGS.has(value.trim().toLowerCase()))
}

/** `public: true` as a boolean or the string "true". */
export function isPublicTrue(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true')
}

/**
 * Why a page is access-restricted on the source site, or undefined.
 * Mintlify: frontmatter `groups` limits a page to those groups; `public: true`
 * without `groups` opens it. `public: false` is the explicit private marker.
 * Empty `groups` (`[]`, `""`, null) restrict nothing; any other non-empty value
 * (list, string, or an unexpected type) is treated as restricting.
 */
export function frontmatterGateReason(data: Record<string, unknown>): string | undefined {
  const groups = data.groups
  const hasGroups = Array.isArray(groups)
    ? groups.length > 0
    : typeof groups === 'string'
      ? groups.trim() !== ''
      : groups !== undefined && groups !== null && groups !== false
  if (hasGroups) return 'frontmatter `groups` restricts it to authenticated groups'
  if (isPublicFalse(data.public)) return 'frontmatter `public: false`'
  return undefined
}

/**
 * The same signals on a navigation group/tab. Mintlify documents only
 * `"public": true` on a group; `groups` (a list of strings, never the nested
 * navigation-group objects a tab also calls `groups`) and `public: false` are
 * honored as well so an authored restriction is never published.
 */
export function navigationGateReason(node: Record<string, unknown>): string | undefined {
  const groups = node.groups
  // A tab also calls its nested navigation group objects `groups`, so an array
  // made only of such containers restricts nothing; any other non-empty array
  // (strings, or a mix with other values) is an access list and gates. As in
  // frontmatter, `Groups:`/`Public:` key casing is ignored, as Mintlify does.
  const isContainer = (entry: unknown): boolean => typeof entry === 'object' && entry !== null && !Array.isArray(entry)
    && ['group', 'pages', 'tab', 'groups', 'page', 'root', 'menu', 'href'].some((key) => key in entry)
  const restricted = typeof groups === 'string'
    ? groups.trim() !== ''
    : Array.isArray(groups) && groups.length > 0 && !groups.every(isContainer)
  if (restricted) return 'its navigation container sets `groups`'
  if (isPublicFalse(node.public)) return 'its navigation container sets `public: false`'
  return undefined
}

const CONFIG_BASENAME = /(?:^|[.-])(?:config|rc)\.[cm]?js$|^(?:tailwind|postcss|next|eslint|prettier|babel|webpack|vite|vitest|jest|rollup|gulpfile|gruntfile|stylelint|commitlint|lint-staged|svgo|metro)[.-]/i
const BUILD_OUTPUT_SEGMENTS = new Set(['dist', 'build', 'coverage'])
const FONT_EXTENSIONS = new Set(['.woff', '.woff2', '.ttf', '.otf'])

/**
 * Mintlify serves every `.css` and `.js` file in the content directory
 * site-wide. Tooling config files and build output are not part of that, and
 * (unlike Mintlify) are never published.
 */
export function isMintlifyServedScriptOrStyle(relativePath: string): boolean {
  const extension = extname(relativePath).toLowerCase()
  if (extension !== '.css' && extension !== '.js') return false
  const segments = relativePath.split('/')
  if (segments.slice(0, -1).some((segment) => BUILD_OUTPUT_SEGMENTS.has(segment.toLowerCase()))) return false
  return extension === '.css' || !CONFIG_BASENAME.test(segments[segments.length - 1])
}

export interface MintlifyFontSource {
  family: string
  /** Value as authored. */
  source: string
  /** Content-relative path when the source is a local file, else null. */
  path: string | null
  remote: boolean
}

/** Self-hosted font references from docs.json `fonts` (top level, `heading`, `body`). */
export function mintlifyFontSources(config: Record<string, unknown> | null): Array<MintlifyFontSource> {
  const fonts = objectValue(config?.fonts)
  if (!fonts) return []
  const found: Array<MintlifyFontSource> = []
  for (const entry of [fonts, objectValue(fonts.heading), objectValue(fonts.body)]) {
    if (!entry || typeof entry.source !== 'string' || !entry.source.trim()) continue
    const source = entry.source.trim()
    const family = typeof entry.family === 'string' ? entry.family : 'a font'
    const remote = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source)
    // A leading slash is relative to the content root, as on Mintlify; the
    // path is only accepted when it stays traversal-free and is a font file.
    const path = remote || /^[a-z]:[\\/]/i.test(source) ? null : normalizeAssetPath(source)
    found.push({ family, source, path: path && FONT_EXTENSIONS.has(extname(path).toLowerCase()) ? path : null, remote })
  }
  return found
}

/**
 * `appearance.default` / `appearance.strict`, with legacy `modeToggle`
 * (`default`, `isHidden`) as fallback per field. docs.json wins when both
 * define a field; invalid values are skipped with a warning.
 */
export function mintlifyAppearance(
  config: Record<string, unknown>,
  warnings: Array<MigrationWarning>,
): NonNullable<MigrationDocsConfig['appearance']> {
  const appearance = objectValue(config.appearance)
  const legacy = objectValue(config.modeToggle)
  const result: NonNullable<MigrationDocsConfig['appearance']> = {}
  const isMode = (value: unknown): value is 'system' | 'light' | 'dark' =>
    value === 'system' || value === 'light' || value === 'dark'
  const skip = (field: string, value: unknown): void => {
    warnings.push({
      code: 'unsupported-config',
      message: `Ignored invalid ${field} value ${JSON.stringify(value)?.slice(0, 40)}; the appearance default was left unchanged.`,
    })
  }
  if (appearance?.default !== undefined) {
    if (isMode(appearance.default)) result.default = appearance.default
    else skip('appearance.default', appearance.default)
  } else if (legacy?.default !== undefined) {
    if (isMode(legacy.default)) result.default = legacy.default
    else skip('modeToggle.default', legacy.default)
  }
  if (appearance?.strict !== undefined) {
    if (typeof appearance.strict === 'boolean') {
      if (appearance.strict) result.showToggle = false
    } else skip('appearance.strict', appearance.strict)
  } else if (legacy?.isHidden !== undefined) {
    if (typeof legacy.isHidden === 'boolean') {
      if (legacy.isHidden) result.showToggle = false
    } else skip('modeToggle.isHidden', legacy.isHidden)
  }
  return result
}

/**
 * Mintlify's playground display mode. `auth` shows the playground only to signed-in
 * readers; Thally has no reader sign-in, so it is carried as `simple` (no playground).
 */
export function playgroundDisplay(value: unknown, where: string, warn?: (message: string) => void): 'interactive' | 'simple' | 'none' | undefined {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (mode === 'interactive' || mode === 'simple' || mode === 'none') return mode
  if (mode === 'auth') {
    warn?.(`${where} "auth" requires reader sign-in, which Thally does not support. Migrated as "simple" (no Try it). Set it to "interactive" to allow everyone.`)
    return 'simple'
  }
  warn?.(`${where} ${JSON.stringify(value)} is not one of interactive, simple, none, auth and was dropped.`)
  return undefined
}
