/**
 * Resolve the site's configured repository URL for reader-facing links
 * ("Edit this page", "Report an issue", code-sample reports, the navbar
 * repository badge). Client-safe: no Node or server-only imports.
 *
 * Compatibility invariant: a URL on github.com or on any unrecognised host
 * keeps producing the same GitHub-style links Thally always built by
 * appending `/edit/...` or `/issues/new` to the configured URL. Only
 * gitlab.com and declared GitLab hosts switch to GitLab's `/-/` routes.
 */

import {
  isPlaceholderRepositoryUrl,
  parseRepositoryReference,
  resolveGitHosts,
  type GitHostConfig,
  type RepositoryRef,
} from '@thallylabs/core/repository'

/**
 * The repository behind `repoUrl`, or null when it is unset, a scaffold
 * placeholder, or not an http(s) URL.
 */
export function resolveRepository(
  repoUrl: string | null | undefined,
  gitHosts?: ReadonlyArray<GitHostConfig>,
): RepositoryRef | null {
  if (isPlaceholderRepositoryUrl(repoUrl)) return null
  const value = (repoUrl as string).trim()
  const parsed = parseRepositoryReference(value, {
    hosts: resolveGitHosts(gitHosts),
    fallbackProvider: 'github',
  })
  if (parsed && /^https?:\/\//i.test(value)) return parsed
  // Unusual but historically working URLs (a single path segment, characters
  // the parser rejects) still get GitHub-style links appended verbatim.
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const path = url.pathname.replace(/\/+$/, '').replace(/^\/+/, '')
    if (!path) return null
    const slash = path.lastIndexOf('/')
    return {
      provider: 'github',
      host: url.hostname,
      origin: url.origin,
      apiBaseUrl: `${url.origin}/api/v3`,
      owner: slash >= 0 ? path.slice(0, slash) : '',
      repo: slash >= 0 ? path.slice(slash + 1) : path,
      fullPath: path,
    }
  } catch {
    return null
  }
}
