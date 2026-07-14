export interface SiteLink {
  label: string
  href: string
}

export type BrandPresetKey = 'primary' | 'secondary'

export interface BrandPalette {
  background: string
  card?: string
  foreground: string
  muted: string
  mutedForeground?: string
  border: string
  accent: string
  accentForeground: string
  accent2?: string
  accent2Foreground?: string
  input?: string
  sidebar?: string
  ring: string
  sidebarActiveBg: string
  sidebarActiveText: string
}

export interface BrandConfig {
  light: BrandPalette
  dark: BrandPalette
}

export interface OgImageConfig {
  /** Background gradient start color (hex). Defaults to dark background from brand. */
  backgroundStart?: string
  /** Background gradient end color (hex). Defaults to dark muted from brand. */
  backgroundEnd?: string
  /** Accent color for top bar and decorative orbs (hex). Defaults to dark accent from brand. */
  accent?: string
  /** Title text color (hex). Defaults to dark foreground from brand. */
  titleColor?: string
  /** Description text color (hex). */
  descriptionColor?: string
  /** Group label text color (hex). Defaults to accent. */
  groupColor?: string
  /** Domain text shown in the bottom bar (e.g. "docs.example.com"). Defaults to THALLY_SITE_URL hostname. */
  domain?: string
  /** Logo text displayed in the bottom bar. Defaults to site name. */
  logoText?: string
  /** Google Font family for the title. Defaults to "Inter". */
  fontFamily?: string
  /** Google Font weight for the title. Defaults to "700". */
  fontWeight?: string
}

export interface AnalyticsConfig {
  /** Google Analytics measurement ID (e.g. "G-XXXXXXXXXX"). */
  googleAnalyticsId?: string
  /** Plausible domain (e.g. "docs.example.com"). */
  plausibleDomain?: string
  /** Plausible script URL. Defaults to "https://plausible.io/js/script.js". */
  plausibleScriptUrl?: string
  /** PostHog project API key. */
  posthogKey?: string
  /** PostHog API host. Defaults to "https://us.i.posthog.com". */
  posthogHost?: string
}

export interface DocVersion {
  /** Version label displayed in the switcher (e.g. "v2.0", "Latest"). */
  label: string
  /** URL for this version. Use "/" for the current site, or a full URL for older versions hosted elsewhere. */
  href: string
  /** Whether this is the currently active version. Exactly one should be true. */
  current?: boolean
}

export interface SiteConfig {
  name: string
  description: string
  repoUrl: string
  links: Array<SiteLink>
  brand: BrandConfig
  brandPreset: BrandPresetKey
  brandPresets: Record<BrandPresetKey, BrandConfig>
  /** Configuration for dynamic OG image generation. All fields are optional and fall back to brand colors. */
  ogImage?: OgImageConfig
  /** Analytics provider configuration. Leave undefined to disable analytics. */
  analytics?: AnalyticsConfig
  /** Doc versions for the version switcher. Leave undefined or empty to hide the switcher. */
  versions?: Array<DocVersion>
}

const brandPresets: Record<BrandPresetKey, BrandConfig> = {
  // Thally's canonical Ink + Iris brand (see Thally-Design-System).
  // Warm off-white surfaces in light mode become near-black ink surfaces in
  // dark mode. Lime remains the primary action color; iris is a restrained
  // secondary accent for visual distinction and chart series.
  primary: {
    light: {
      background: '#FCFCF7',
      card: '#FFFFFF',
      foreground: '#1A2018',
      muted: '#EFEFE9',
      mutedForeground: '#747B72',
      border: '#E5E6E1',
      accent: '#007852',
      accentForeground: '#FFFFFF',
      accent2: '#755FBB',
      accent2Foreground: '#0B0A13',
      input: '#E5E6E1',
      sidebar: '#F7F7F2',
      ring: '#397059',
      // Olive-family tint (the leaf's own green) for the active sidebar item
      sidebarActiveBg: '68 40% 88% / 0.65',
      sidebarActiveText: '#454A22',
    },
    dark: {
      background: '#040704',
      card: '#060906',
      foreground: '#EFEFE7',
      muted: '#0E130F',
      mutedForeground: '#929C90',
      border: '#1B1E1A',
      accent: '#BAE43E',
      accentForeground: '#101911',
      accent2: '#AC9CF0',
      accent2Foreground: '#0B0A13',
      input: '#29302A',
      sidebar: '#060906',
      ring: '#BAE43E',
      sidebarActiveBg: '132 15% 6%',
      sidebarActiveText: '#BAE43E',
    },
  },
  // Alternate preset — violet. Still a first-class, ready-to-use accent.
  secondary: {
    light: {
      background: '#FFFFFF',
      foreground: '#0F172A',
      muted: '#F5F3FF',
      border: '#E4E4F7',
      accent: '#8B5CF6',
      accentForeground: '#F5F3FF',
      ring: '#A855F7',
      sidebarActiveBg: '262 83% 90% / 0.5',
      sidebarActiveText: '#312E81',
    },
    dark: {
      background: '#070B14',
      foreground: '#EDE9FE',
      muted: '#141129',
      border: '#1C1A2C',
      accent: '#C084FC',
      accentForeground: '#0B1220',
      ring: '#C084FC',
      sidebarActiveBg: '262 45% 32% / 0.3',
      sidebarActiveText: '#EDE9FE',
    },
  },
}

const brandPreset: BrandPresetKey = 'primary'

export const siteConfig: SiteConfig = {
  name: 'Thally',
  description:
    'Thally is the first agent-native documentation platform. Every page is served to humans as polished HTML and to AI agents as structured JSON, JSON-LD, and Markdown from the same URL — self-hosted, open, and fully extensible.',
  repoUrl: '',
  links: [
    { label: 'Get started', href: '/quickstart' },
    { label: 'Support', href: 'https://github.com/thallylabs/thally/issues/new' },
    { label: 'GitHub', href: 'https://github.com/thallylabs/thally' },
    { label: 'Changelog', href: '/changelog' },
  ],
  brand: brandPresets[brandPreset],
  brandPreset,
  brandPresets,
}
