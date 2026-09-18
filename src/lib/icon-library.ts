/**
 * Icon library selection shared by the layout, the docs.json reader, and the
 * content Icon component.
 *
 * Site owners pick one library in docs.json (`icons.library`). Bundled Lucide
 * glyphs and inline brand marks render offline; every other name resolves to
 * the selected library's SVG on jsDelivr through a CSS mask, so no library has
 * to ship in the Worker bundle. Versions are pinned so a site never changes
 * glyphs without a runtime release.
 */

export const ICON_LIBRARIES = ['lucide', 'fontawesome', 'tabler'] as const

export type IconLibrary = (typeof ICON_LIBRARIES)[number]

export const DEFAULT_ICON_LIBRARY: IconLibrary = 'lucide'

/** Authoring style hints. Font Awesome and Tabler map these onto their own sets. */
export type IconStyle = 'regular' | 'solid' | 'outline' | 'brands'

const CDN_BASE = 'https://cdn.jsdelivr.net/npm'
const LUCIDE_STATIC_VERSION = '1.47.0'
const FONT_AWESOME_VERSION = '7.3.1'
const TABLER_ICONS_VERSION = '3.46.0'

/** Icon names are lowercase kebab-case slugs; anything else never reaches a URL. */
export const ICON_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isIconLibrary(value: unknown): value is IconLibrary {
  return typeof value === 'string' && (ICON_LIBRARIES as readonly string[]).includes(value)
}

/** Resolve a docs.json value to a supported library, defaulting to Lucide. */
export function resolveIconLibrary(value: unknown): IconLibrary {
  return isIconLibrary(value) ? value : DEFAULT_ICON_LIBRARY
}

/**
 * Font Awesome brand slugs that have no inline equivalent yet. They resolve to
 * the Font Awesome brands set under every library so migrated Mintlify content
 * keeps its logos.
 */
export const FONT_AWESOME_BRAND_NAMES: ReadonlySet<string> = new Set([
  'amazon', 'atlassian', 'aws', 'behance', 'bitcoin', 'chrome', 'codepen', 'confluence', 'dev',
  'dribbble', 'dropbox', 'edge', 'ethereum', 'facebook', 'firefox', 'google', 'google-drive',
  'hashnode', 'instagram', 'jira', 'linkedin', 'medium', 'microsoft', 'openai', 'paypal',
  'pinterest', 'reddit', 'safari', 'salesforce', 'slack', 'spotify', 'stack-overflow', 'telegram',
  'tiktok', 'trello', 'twitch', 'unity', 'whatsapp', 'windows',
])

function fontAwesomeStyle(style: IconStyle | undefined): 'solid' | 'regular' | 'brands' {
  if (style === 'regular') return 'regular'
  if (style === 'brands') return 'brands'
  // Font Awesome Free ships the broadest coverage in its solid set, so the
  // authoring default ("outline") lands there instead of a mostly-empty set.
  return 'solid'
}

/** Build the pinned CDN URL for one icon name in one library. */
export function iconLibraryAssetUrl(library: IconLibrary, name: string, style?: IconStyle): string {
  if (!ICON_NAME_PATTERN.test(name)) throw new Error(`Unsafe icon name: ${name}`)
  switch (library) {
    case 'fontawesome':
      return `${CDN_BASE}/@fortawesome/fontawesome-free@${FONT_AWESOME_VERSION}/svgs/${fontAwesomeStyle(style)}/${name}.svg`
    case 'tabler':
      return `${CDN_BASE}/@tabler/icons@${TABLER_ICONS_VERSION}/icons/${style === 'solid' ? 'filled' : 'outline'}/${name}.svg`
    default:
      return `${CDN_BASE}/lucide-static@${LUCIDE_STATIC_VERSION}/icons/${name}.svg`
  }
}

/** Font Awesome brand URL used for the brand fallback under every library. */
export function fontAwesomeBrandUrl(name: string): string {
  return iconLibraryAssetUrl('fontawesome', name, 'brands')
}
