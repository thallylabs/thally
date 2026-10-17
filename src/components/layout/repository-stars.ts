/**
 * Star count for the navbar repository link (GitHub or GitLab), fetched once
 * per session and cached with a TTL. Public, unauthenticated API reads only;
 * any failure hides the count rather than surfacing an error.
 */

import {
  repositoryApiProjectUrl,
  starCountFromApiPayload,
  type RepositoryRef,
} from '@thallylabs/core/repository'

const TTL_MS = 60 * 60 * 1000
const inflight = new Map<string, Promise<number | null>>()

function readCache(key: string): number | null | undefined {
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) ?? 'null') as { stars: number; at: number } | null
    return cached && Date.now() - cached.at < TTL_MS ? cached.stars : undefined
  } catch {
    return undefined
  }
}

/** Resolves to the star count, or null when the API is unavailable or rate-limited (the caller hides the count). */
export function fetchRepositoryStars(
  repository: Pick<RepositoryRef, 'provider' | 'host' | 'apiBaseUrl' | 'fullPath'>,
): Promise<number | null> {
  // github.com keeps its historical cache key so existing sessions stay warm.
  const key = repository.provider === 'github' && repository.host === 'github.com'
    ? `thally:github-stars:${repository.fullPath}`
    : `thally:repo-stars:${repository.host}/${repository.fullPath}`
  const cached = readCache(key)
  if (cached !== undefined) return Promise.resolve(cached)
  const pending = inflight.get(key) ?? fetch(repositoryApiProjectUrl(repository))
    .then((response) => (response.ok ? response.json() : null))
    .then((data: unknown) => {
      const stars = starCountFromApiPayload(data)
      if (stars !== null) {
        try { sessionStorage.setItem(key, JSON.stringify({ stars, at: Date.now() })) } catch { /* storage may be blocked */ }
      }
      return stars
    })
    .catch(() => null)
  inflight.set(key, pending)
  return pending
}
