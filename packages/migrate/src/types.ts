/**
 * Canonical migration contracts shared by repository, CLI, MCP, and hosted
 * import paths. Callers materialize this bundle only after discovery and
 * normalization finish, so a partial crawl can never leave a half-written site.
 */

export type MigrationPlatform =
  | 'mintlify'
  | 'docusaurus'
  | 'fern'
  | 'gitbook'
  | 'nextra'
  | 'vitepress'
  | 'starlight'
  | 'thally'
  | 'generic'
  | 'unknown'

export interface MigrationNavigationGroup {
  group: string
  icon?: string
  hidden?: boolean
  pages: Array<string | MigrationNavigationGroup>
}

export interface MigrationNavigationTab {
  tab: string
  description?: string
  icon?: string
  href?: string
  hidden?: boolean
  /** Root page/group nodes used when the source has no synthetic section heading. */
  pages?: Array<string | MigrationNavigationGroup>
  groups?: Array<MigrationNavigationGroup>
  api?: { source: string; navigation?: boolean }
}

export interface MigrationBannerConfig {
  content: string | Record<string, string>
  dismissible?: boolean
  id?: string
  revision?: string
  type?: 'info' | 'warning' | 'critical'
  color?: { light?: string; dark?: string }
}

export interface MigrationNavbarConfig {
  links?: Array<{ label: string; href: string; type?: 'github' }>
  /** Explicit null suppresses the starter's sample call to action. */
  primary?: { label: string; href: string } | null
  /** Local public assets used until an owner uploads a brand replacement. */
  /** Explicit null requests a text-only brand when the source has no logo. */
  logo?: { light: string; dark?: string; showTitle?: boolean; rightText?: string } | null
}

export interface MigrationFooterConfig {
  socials?: Record<string, string>
  /** Literal footer attribution; `{year}` is resolved by the site at render time. */
  copyright?: string
  links?: Array<{
    heading: string
    items: Array<{ label: string; href: string }>
  }>
}

export interface MigrationDocsConfig {
  markdown?: { enabled?: boolean }
  tabs: Array<MigrationNavigationTab>
  navigation?: {
    /** How sibling documentation collections are presented to readers. */
    display?: 'tabs' | 'dropdown'
  }
  theme?: 'default' | 'maple' | 'sharp' | 'minimal'
  appearance?: { default?: 'system' | 'light' | 'dark'; showToggle?: boolean }
  background?: { image?: string; imageDark?: string; decoration?: 'none' | 'grid' | 'gradient' }
  /** Icon set for content `icon` names; Mintlify's `icons.library` carries through. */
  icons?: { library?: 'lucide' | 'fontawesome' | 'tabler' }
  banner?: MigrationBannerConfig
  navbar?: MigrationNavbarConfig
  favicon?: { light: string; dark?: string }
  footer?: MigrationFooterConfig
  seo?: { indexing?: 'navigable' | 'all' }
  fonts?: {
    body?: { family: string; weight?: Array<string> }
    heading?: { family: string; weight?: Array<string> }
  }
  feedback?: { thumbsRating?: boolean }
  ai?: { chat?: boolean; label?: string; icon?: string }
  admin?: { enabled?: boolean }
  analytics?: { enabled?: boolean }
  /** Manual API pages: default server(s) and auth for `api:` frontmatter pages. */
  api?: { mdx?: { server?: string | Array<string>; auth?: { method?: 'bearer' | 'basic' | 'key'; name?: string } } }
  redirects?: Array<{ source: string; destination: string; permanent?: boolean }>
  i18n?: {
    defaultLocale: string
    locales: Array<{ code: string; label: string }>
    /** Source-authored navigation labels and ordering for each translation. */
    navigation?: Record<string, Array<MigrationNavigationTab>>
  }
}

export interface MigrationPage {
  /** Path below `src/content`, without the `.mdx` extension. */
  id: string
  /** Locale-independent page id used by the shared navigation projection. */
  navigationId: string
  locale?: string
  title: string
  navTitle?: string
  description: string
  /** Keep SEO/search description without repeating it above Docusaurus body copy. */
  descriptionPlacement?: 'body'
  badge?: string
  keywords: Array<string>
  mode?: 'default' | 'wide' | 'custom' | 'center' | 'home'
  hidden?: boolean
  noindex?: boolean
  /** OpenAPI operation key rendered by Thally instead of ordinary MDX. */
  openapi?: string
  /** Manual API page: `METHOD <url-or-path>`; rendered by Thally's playground. */
  api?: string
  /** Page-level playground auth override: bearer | basic | key | none. */
  authMethod?: string
  body: string
  source: string
  /** Set when the page's frontmatter was invalid YAML; the page is kept with a best-effort salvage. */
  frontmatterError?: string
}

export interface MigrationAsset {
  /** Path below `public` (or below the project root when `projectRelative`), always normalized and traversal-free. */
  path: string
  content: Uint8Array
  /** Write at the project root instead of `public/`, so the host never serves it statically. */
  projectRelative?: boolean
}

export interface MigrationWarning {
  code:
    | 'collision'
    | 'invalid-page'
    | 'missing-page'
    | 'unsupported-config'
    | 'limit-reached'
    | 'fetch-failed'
    | 'skipped-file'
  message: string
  source?: string
}

export interface MigrationBundle {
  sourceUrl: string
  sourceKind: 'repository' | 'url'
  platform: MigrationPlatform
  pages: Array<MigrationPage>
  assets: Array<MigrationAsset>
  /** Repository-configured remote specs awaiting a bounded network fetch by the host. */
  remoteApiSpecs?: Array<{ url: string; tabLabel?: string; parentTab?: string; icon?: string; hidden?: boolean }>
  /** Customer-owned component source and registry; paths are repository-relative. */
  componentFiles?: Array<RenderedMigrationFile>
  docsConfig: MigrationDocsConfig
  site?: {
    name?: string
    description?: string
    /**
     * Source theme accent color(s), each a `#rrggbb`/`#rgb` hex string.
     * Follows Mintlify's own `colors` schema: `light` is the color used in
     * dark mode and `dark` is the color used in light mode. Fern's colors
     * are normal (its `light`/`dark` match the mode they paint), so
     * extraction swaps them onto this shape for a single downstream contract.
     */
    colors?: {
      primary?: string
      light?: string
      dark?: string
    }
  }
  warnings: Array<MigrationWarning>
  stats: {
    discovered: number
    imported: number
    skipped: number
  }
}

export interface MigrationFetchRequest {
  accept: string
}

export interface MigrationFetchResponse {
  finalUrl: URL
  body: string
  contentType: string
  headers?: Record<string, string | undefined>
}

/**
 * Network boundary injected by each host. Thally Cloud supplies a DNS-pinned,
 * SSRF-safe implementation; the local CLI uses the user's normal network.
 */
export type MigrationFetcher = (
  url: URL,
  request: MigrationFetchRequest,
) => Promise<MigrationFetchResponse>

export interface RenderedMigrationFile {
  path: string
  content: string | Uint8Array
}
