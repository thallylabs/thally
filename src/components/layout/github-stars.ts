/** @deprecated Import `fetchRepositoryStars` from `./repository-stars`; kept for existing imports. */

import { DEFAULT_GIT_HOSTS } from '@thallylabs/core/repository'
import { fetchRepositoryStars } from './repository-stars'

/** Star count for a github.com `owner/repo`; null when unavailable. */
export function fetchGithubStars(repo: string): Promise<number | null> {
  const github = DEFAULT_GIT_HOSTS[0]
  return fetchRepositoryStars({ provider: 'github', host: github.host, apiBaseUrl: github.apiBaseUrl, fullPath: repo })
}
