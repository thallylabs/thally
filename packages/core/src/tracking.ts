/**
 * Thally Track configuration — the `@thallylabs/core/tracking` entry point.
 *
 * `docs.json` `tracking.repos[]` names the product repositories whose merged
 * pull or merge requests should become documentation work. This module is the
 * single definition of that shape for the site runtime, CLI, MCP server,
 * scaffolder, and docs agent.
 *
 * Compatibility: an entry with only `owner` and `repo` means a github.com
 * repository, exactly as before GitLab support. GitLab entries set
 * `provider: "gitlab"` and put the full namespace (`group/subgroup`) in
 * `owner`; self-hosted instances add `host`. Pure and client-safe.
 */

import { findGitHost, isGitProvider, normalizeGitHostname, resolveGitHosts } from './repository/hosts.js'
import type { GitHostConfig, GitProvider, RepositoryRef } from './repository/types.js'

/** One tracked product repository as written in docs.json. */
export interface TrackedRepoConfig {
  /** GitHub owner, or the full GitLab namespace such as `group/subgroup`. */
  owner: string
  repo: string
  /** Defaults to `github`, or to the provider declared for `host`. */
  provider?: GitProvider
  /** Self-hosted hostname without scheme. Defaults to github.com or gitlab.com. */
  host?: string
  /** Base branch changes must merge into to trigger. Defaults to `main`. */
  branch?: string
  /** Path globs; only changes touching these trigger docs tasks. Absent means all files. */
  paths?: Array<string>
  /** Sidebar tab generated pages should land in. */
  outputTab?: string
  /** Group heading within that tab. */
  outputGroup?: string
}

/** The `tracking` block of docs.json. */
export interface TrackingConfig {
  repos: Array<TrackedRepoConfig>
}

/** A tracked repository with provider, host, and branch defaults applied. */
export interface ResolvedTrackedRepo extends TrackedRepoConfig {
  provider: GitProvider
  host: string
  branch: string
}

const DEFAULT_BRANCH = 'main'
const DEFAULT_HOST_BY_PROVIDER: Record<GitProvider, string> = { github: 'github.com', gitlab: 'gitlab.com' }

/** Fill provider, host, and branch defaults. Declared hosts decide the provider when it is omitted. */
export function normalizeTrackedRepo(
  entry: TrackedRepoConfig,
  knownHosts?: ReadonlyArray<GitHostConfig>,
): ResolvedTrackedRepo {
  const declaredHost = entry.host ? normalizeGitHostname(entry.host) : null
  const known = declaredHost ? findGitHost(declaredHost, resolveGitHosts(knownHosts)) : null
  const provider: GitProvider = isGitProvider(entry.provider) ? entry.provider : known?.provider ?? 'github'
  return {
    ...entry,
    provider,
    host: declaredHost ?? DEFAULT_HOST_BY_PROVIDER[provider],
    branch: entry.branch || DEFAULT_BRANCH,
  }
}

/**
 * Stable identity used to upsert and match tracked repositories. Provider and
 * host are part of the key, so `acme/api` on GitHub and on GitLab stay distinct.
 */
export function trackedRepoKey(entry: TrackedRepoConfig, knownHosts?: ReadonlyArray<GitHostConfig>): string {
  const resolved = normalizeTrackedRepo(entry, knownHosts)
  return `${resolved.provider}:${resolved.host}:${resolved.owner}/${resolved.repo}`.toLowerCase()
}

/** Runtime shape check for one docs.json entry. */
export function isTrackedRepoConfig(value: unknown): value is TrackedRepoConfig {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  if (typeof entry.owner !== 'string' || !entry.owner.trim()) return false
  if (typeof entry.repo !== 'string' || !entry.repo.trim()) return false
  if (entry.provider !== undefined && !isGitProvider(entry.provider)) return false
  if (entry.host !== undefined && (typeof entry.host !== 'string' || !normalizeGitHostname(entry.host))) return false
  if (entry.branch !== undefined && typeof entry.branch !== 'string') return false
  if (entry.paths !== undefined && !(Array.isArray(entry.paths) && entry.paths.every((p) => typeof p === 'string'))) {
    return false
  }
  return true
}

/** Read the tracking block from a docs.json value, dropping malformed entries. */
export function readTrackingConfig(docsJson: unknown): TrackingConfig {
  if (!docsJson || typeof docsJson !== 'object') return { repos: [] }
  const tracking = (docsJson as { tracking?: unknown }).tracking
  if (!tracking || typeof tracking !== 'object') return { repos: [] }
  const repos = (tracking as { repos?: unknown }).repos
  return { repos: Array.isArray(repos) ? repos.filter(isTrackedRepoConfig) : [] }
}

/** Repository reference for a tracked entry (for URL builders and API clients). */
export function trackedRepoRef(entry: TrackedRepoConfig, knownHosts?: ReadonlyArray<GitHostConfig>): RepositoryRef {
  const resolved = normalizeTrackedRepo(entry, knownHosts)
  const known = findGitHost(resolved.host, resolveGitHosts(knownHosts))
  const origin = known?.origin ?? `https://${resolved.host}`
  const apiBaseUrl = known && known.provider === resolved.provider
    ? known.apiBaseUrl
    : resolved.provider === 'gitlab'
      ? `${origin}/api/v4`
      : resolved.host === 'github.com' ? 'https://api.github.com' : `${origin}/api/v3`
  return {
    provider: resolved.provider,
    host: resolved.host,
    origin,
    apiBaseUrl,
    owner: resolved.owner,
    repo: resolved.repo,
    fullPath: `${resolved.owner}/${resolved.repo}`,
  }
}

/**
 * Human-readable name: `acme/api` for github.com, `gitlab:group/api` for
 * gitlab.com, and `host:owner/repo` for self-hosted instances.
 */
export function describeTrackedRepo(entry: TrackedRepoConfig, knownHosts?: ReadonlyArray<GitHostConfig>): string {
  const resolved = normalizeTrackedRepo(entry, knownHosts)
  const path = `${resolved.owner}/${resolved.repo}`
  if (resolved.host === DEFAULT_HOST_BY_PROVIDER[resolved.provider]) {
    return resolved.provider === 'github' ? path : `gitlab:${path}`
  }
  return `${resolved.host}:${path}`
}

/**
 * Minimal docs.json entry for a repository: provider and host are written only
 * when they differ from the defaults, keeping GitHub entries unchanged.
 */
export function trackedRepoEntry(
  ref: Pick<RepositoryRef, 'provider' | 'host' | 'owner' | 'repo'>,
  fields: Omit<TrackedRepoConfig, 'owner' | 'repo' | 'provider' | 'host'> = {},
): TrackedRepoConfig {
  const entry: TrackedRepoConfig = { owner: ref.owner, repo: ref.repo }
  if (ref.provider !== 'github') entry.provider = ref.provider
  if (ref.host !== DEFAULT_HOST_BY_PROVIDER[ref.provider]) entry.host = ref.host
  return { ...entry, ...fields }
}
