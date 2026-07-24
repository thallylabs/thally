/** Public entry point for Thally's shared repository and live-site migration engine. */

export {
  cloneGitHubRepository,
  detectRepositoryDocsDir,
  detectRepositoryPlatform,
  migrateRepository,
  parseGitHubRepositoryUrl,
} from './repository.js'
export { buildNavigationFromPages, projectMintlifyNavigation, readMintlifyConfig } from './navigation.js'
export { normalizeMdx, parseMarkdownPage } from './mdx.js'
export { mergeMigrationConfig, renderMigrationFiles } from './render.js'
export { defaultMigrationFetcher, migrateUrl, validateMigrationUrl } from './url.js'
export type {
  GitHubRepositorySource,
  RepositoryMigrationOptions,
} from './repository.js'
export type { UrlMigrationOptions } from './url.js'
export type {
  MigrationAsset,
  MigrationBundle,
  MigrationDocsConfig,
  MigrationFetcher,
  MigrationFetchRequest,
  MigrationFetchResponse,
  MigrationNavigationGroup,
  MigrationNavigationTab,
  MigrationPage,
  MigrationPlatform,
  MigrationWarning,
  RenderedMigrationFile,
} from './types.js'
