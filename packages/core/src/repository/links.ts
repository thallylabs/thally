/**
 * Provider-aware URL builders and labels.
 *
 * GitHub output is intentionally identical to the strings Thally built before
 * GitLab support existed (`/edit/<branch>/<path>`, `/issues/new?title=...`),
 * so existing sites see no link changes. GitLab uses its `/-/` route prefix
 * and `issue[title]` / `issue[description]` prefill parameters.
 */

import type { GitProvider, RepositoryRef } from './types.js'

type RepositoryLocation = Pick<RepositoryRef, 'provider' | 'origin' | 'fullPath'>

function encodePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function routePrefix(ref: RepositoryLocation): string {
  return ref.provider === 'gitlab' ? `${repositoryWebUrl(ref)}/-` : repositoryWebUrl(ref)
}

/** Repository home page, for example `https://gitlab.com/group/sub/project`. */
export function repositoryWebUrl(ref: RepositoryLocation): string {
  return `${ref.origin}/${ref.fullPath}`
}

/** HTTPS or SSH clone URL. */
export function repositoryCloneUrl(
  ref: Pick<RepositoryRef, 'origin' | 'host' | 'fullPath'>,
  protocol: 'https' | 'ssh' = 'https',
): string {
  return protocol === 'ssh' ? `git@${ref.host}:${ref.fullPath}.git` : `${ref.origin}/${ref.fullPath}.git`
}

/** Directory listing for a branch, optionally inside a subdirectory. */
export function repositoryTreeUrl(ref: RepositoryLocation, branch: string, path = ''): string {
  const suffix = encodePath(path)
  return `${routePrefix(ref)}/tree/${encodePath(branch)}${suffix ? `/${suffix}` : ''}`
}

/** Web editor for one file. */
export function repositoryEditFileUrl(ref: RepositoryLocation, branch: string, filePath: string): string {
  return `${routePrefix(ref)}/edit/${encodePath(branch)}/${encodePath(filePath)}`
}

/** Raw file contents. github.com serves these from raw.githubusercontent.com. */
export function repositoryRawFileUrl(
  ref: RepositoryLocation & Pick<RepositoryRef, 'host'>,
  branch: string,
  filePath: string,
): string {
  if (ref.provider === 'github' && ref.host === 'github.com') {
    return `https://raw.githubusercontent.com/${ref.fullPath}/${encodePath(branch)}/${encodePath(filePath)}`
  }
  return `${routePrefix(ref)}/raw/${encodePath(branch)}/${encodePath(filePath)}`
}

/** Query-parameter names each provider uses to prefill a new issue. */
export function issueQueryKeys(provider: GitProvider): { title: string; body: string } {
  return provider === 'gitlab'
    ? { title: 'issue[title]', body: 'issue[description]' }
    : { title: 'title', body: 'body' }
}

/** Base "new issue" page without prefill. */
export function repositoryIssuesNewUrl(ref: RepositoryLocation): string {
  return `${routePrefix(ref)}/issues/new`
}

/**
 * "New issue" page, optionally prefilled. Values are encoded with
 * `encodeURIComponent` so GitHub output matches the historical format.
 */
export function repositoryNewIssueUrl(
  ref: RepositoryLocation,
  params: { title?: string; body?: string } = {},
): string {
  const keys = issueQueryKeys(ref.provider)
  const query: Array<string> = []
  if (params.title !== undefined) query.push(`${encodeURIComponent(keys.title)}=${encodeURIComponent(params.title)}`)
  if (params.body !== undefined) query.push(`${encodeURIComponent(keys.body)}=${encodeURIComponent(params.body)}`)
  const base = repositoryIssuesNewUrl(ref)
  return query.length > 0 ? `${base}?${query.join('&')}` : base
}

/** Pull request (GitHub) or merge request (GitLab) page. */
export function repositoryPullRequestUrl(ref: RepositoryLocation, number: number): string {
  return ref.provider === 'gitlab'
    ? `${routePrefix(ref)}/merge_requests/${number}`
    : `${repositoryWebUrl(ref)}/pull/${number}`
}

/** REST resource for the repository itself (stars, size, default branch). */
export function repositoryApiProjectUrl(ref: Pick<RepositoryRef, 'provider' | 'apiBaseUrl' | 'fullPath'>): string {
  return ref.provider === 'gitlab'
    ? `${ref.apiBaseUrl}/projects/${encodeURIComponent(ref.fullPath)}`
    : `${ref.apiBaseUrl}/repos/${ref.fullPath}`
}

/** Read a star count from either provider's repository payload. */
export function starCountFromApiPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as { stargazers_count?: unknown; star_count?: unknown }
  const value = typeof record.stargazers_count === 'number' ? record.stargazers_count : record.star_count
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

const PROVIDER_LABELS: Record<GitProvider, 'GitHub' | 'GitLab'> = { github: 'GitHub', gitlab: 'GitLab' }
const PULL_REQUEST_NOUNS: Record<GitProvider, 'pull request' | 'merge request'> = {
  github: 'pull request',
  gitlab: 'merge request',
}

/** Display name of a provider. */
export function providerLabel(provider: GitProvider): 'GitHub' | 'GitLab' {
  return PROVIDER_LABELS[provider]
}

/** "pull request" or "merge request". */
export function pullRequestNoun(provider: GitProvider): 'pull request' | 'merge request' {
  return PULL_REQUEST_NOUNS[provider]
}

/** Short reference such as `#42` (GitHub) or `!42` (GitLab). */
export function pullRequestLabel(provider: GitProvider, number: number): string {
  return `${provider === 'gitlab' ? '!' : '#'}${number}`
}

/**
 * True when a configured repository URL is missing or still the scaffold
 * placeholder, in which case repository links must not render.
 */
export function isPlaceholderRepositoryUrl(url: string | null | undefined): boolean {
  return !url || url.includes('your-org')
}

/** True for docs.json link `type` values that mark a repository link. */
export function isRepositoryLinkType(type: string | null | undefined): type is GitProvider {
  return type === 'github' || type === 'gitlab'
}
