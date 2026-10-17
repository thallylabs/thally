// ---------------------------------------------------------------------------
// Thally Track — shared pull/merge-request distiller (`@thallylabs/mcp/track`).
//
// Turns a MERGED pull request (GitHub) or merge request (GitLab) in a tracked
// product repository into the material a docs task needs: API fetchers, the
// path-glob filter, and the instruction/context builder. A merged request —
// not a raw commit — is the unit of completed, reviewed change, so Track only
// acts on merges. Consumed by the MCP `sync_from_repo` tool, `@thallylabs/cli`
// (`thally track`), the docs agent, and Thally Cloud's webhook receiver.
//
// The published bundle stays dependency-free (node:crypto only): the small,
// pure `@thallylabs/core` repository/tracking helpers are inlined at build time.
// ---------------------------------------------------------------------------

export * from "./shared.js";
export * from "./github.js";
export * from "./gitlab.js";
export * from "./client.js";

// Repository and tracking helpers from @thallylabs/core, re-exported so Track
// consumers (CLI, docs agent) share one parser without a direct core dependency.
export {
  DEFAULT_GIT_HOSTS,
  parseGitHostsEnv,
  parseRepositoryReference,
  providerLabel,
  pullRequestLabel,
  pullRequestNoun,
  readGitHostsConfig,
  repositoryCloneUrl,
  repositoryPullRequestUrl,
  repositoryWebUrl,
  resolveGitHosts,
} from "@thallylabs/core/repository";
export type {
  GitHostConfig,
  GitProvider,
  GitProviderHost,
  ParseRepositoryOptions,
  RepositoryRef,
} from "@thallylabs/core/repository";
export {
  describeTrackedRepo,
  isTrackedRepoConfig,
  normalizeTrackedRepo,
  readTrackingConfig,
  trackedRepoEntry,
  trackedRepoKey,
  trackedRepoRef,
} from "@thallylabs/core/tracking";
export type { ResolvedTrackedRepo, TrackedRepoConfig, TrackingConfig } from "@thallylabs/core/tracking";
