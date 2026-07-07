export interface SiteLink {
  label: string
  href: string
}

export type BrandPresetKey = 'primary' | 'secondary'

export interface BrandPalette {
  background: string
  foreground: string
  muted: string
  border: string
  accent: string
  accentForeground: string
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
  /** Domain text shown in the bottom bar (e.g. "docs.example.com"). Defaults to DOX_SITE_URL hostname. */
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
  primary: {
    light: {
      background: '#FFFFFF',
      foreground: '#0F172A',
      muted: '#F8FAFC',
      border: '#E2E8F0',
      accent: '#10B981',
      accentForeground: '#ECFEF3',
      ring: '#10B981',
      sidebarActiveBg: '152 60% 88% / 0.55',
      sidebarActiveText: '#0F172A',
    },
    dark: {
      background: '#0B1220',
      foreground: '#F8FAFC',
      muted: '#111827',
      border: '#1F2937',
      accent: '#34D399',
      accentForeground: '#0B1220',
      ring: '#34D399',
      sidebarActiveBg: '152 40% 30% / 0.35',
      sidebarActiveText: '#A7F3D0',
    },
  },
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
      background: '#0B1220',
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

const brandPreset: BrandPresetKey = 'secondary'

export const siteConfig: SiteConfig = {
  name: 'Dox',
  description:
    'Dox is the first agent-native documentation platform. Every page is served to humans as polished HTML and to AI agents as structured JSON, JSON-LD, and Markdown from the same URL — self-hosted, open, and fully extensible.',
  repoUrl: '',
  links: [
    { label: 'Get started', href: '/quickstart' },
    { label: 'Support', href: 'https://github.com/kenny-io/Dox/issues/new' },
    { label: 'GitHub', href: 'https://github.com/kenny-io/Dox' },
    { label: 'Changelog', href: '/changelog' },
  ],
  brand: brandPresets[brandPreset],
  brandPreset,
  brandPresets,
}

