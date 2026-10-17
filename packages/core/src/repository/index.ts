/**
 * Repository-host helpers — the `@thallylabs/core/repository` entry point.
 *
 * Pure string and URL logic with no Node built-ins, so it is safe in client
 * components (navbar star badge, footer, feedback links) as well as in the
 * CLI, MCP server, migration engine, and docs agent. Every surface that needs
 * to know whether a repository lives on GitHub or GitLab goes through here, so
 * the two providers' URL conventions are encoded exactly once.
 */
export type { GitHostConfig, GitProvider, GitProviderHost, RepositoryRef } from './types.js'
export {
  DEFAULT_GIT_HOSTS,
  defaultApiBaseUrl,
  findGitHost,
  isGitProvider,
  normalizeGitHostname,
  parseGitHostsEnv,
  readGitHostsConfig,
  resolveGitHosts,
  toGitProviderHost,
} from './hosts.js'
export { parseRepositoryReference } from './parse.js'
export type { ParseRepositoryOptions } from './parse.js'
export {
  isPlaceholderRepositoryUrl,
  isRepositoryLinkType,
  issueQueryKeys,
  providerLabel,
  pullRequestLabel,
  pullRequestNoun,
  repositoryApiProjectUrl,
  repositoryCloneUrl,
  repositoryEditFileUrl,
  repositoryIssuesNewUrl,
  repositoryNewIssueUrl,
  repositoryPullRequestUrl,
  repositoryRawFileUrl,
  repositoryTreeUrl,
  repositoryWebUrl,
  starCountFromApiPayload,
} from './links.js'
