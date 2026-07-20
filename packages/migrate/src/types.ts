/**
 * Canonical migration contracts shared by repository, CLI, MCP, and hosted
 * import paths. Callers materialize this bundle only after discovery and
 * normalization finish, so a partial crawl can never leave a half-written site.
 */

export type MigrationPlatform =
  | 'mintlify'
  | 'docusaurus'
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
  pages: Array<string | MigrationNavigationGroup>
}

export interface MigrationNavigationTab {
  tab: string
  href?: string
  groups?: Array<MigrationNavigationGroup>
  api?: { source: string }
}

export interface MigrationDocsConfig {
  tabs: Array<MigrationNavigationTab>
  theme?: 'default' | 'maple' | 'sharp' | 'minimal'
  ai?: { chat?: boolean; label?: string; icon?: string }
  admin?: { enabled?: boolean }
  analytics?: { enabled?: boolean }
  redirects?: Array<{ source: string; destination: string; permanent?: boolean }>
  i18n?: {
    defaultLocale: string
    locales: Array<{ code: string; label: string }>
  }
}

export interface MigrationPage {
  /** Path below `src/content`, without the `.mdx` extension. */
  id: string
  /** Locale-independent page id used by the shared navigation projection. */
  navigationId: string
  locale?: string
  title: string
  description: string
  keywords: Array<string>
  body: string
  source: string
}

export interface MigrationAsset {
  /** Path below `public`, always normalized and traversal-free. */
  path: string
  content: Uint8Array
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
  docsConfig: MigrationDocsConfig
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
