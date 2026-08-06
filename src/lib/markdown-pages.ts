/**
 * Edge-safe resolution for the optional `.md` page URL surface.
 *
 * Repository configuration is the self-hosted default. Thally Cloud can
 * override it through the signed portable runtime snapshot, so managed and
 * linked sites use the same contract without exposing a control-plane secret.
 */

import docsNavigationConfig from '../../docs.json' assert { type: 'json' }

interface MarkdownPagesConfig {
  markdown?: {
    enabled?: boolean
  }
}

interface MarkdownPagesPortableConfig {
  markdown?: {
    enabled?: boolean
  }
}

/** Whether the repository explicitly enables page URLs ending in `.md`. */
export function isRepositoryMarkdownPagesEnabled(): boolean {
  const config = docsNavigationConfig as MarkdownPagesConfig
  return config.markdown?.enabled === true
}

/**
 * Resolve the effective setting. An explicit Cloud value wins; absent values
 * preserve the repository-owned behavior for self-hosted and older sites.
 */
export function isMarkdownPagesEnabled(
  portable?: MarkdownPagesPortableConfig | null,
): boolean {
  return portable?.markdown?.enabled ?? isRepositoryMarkdownPagesEnabled()
}
