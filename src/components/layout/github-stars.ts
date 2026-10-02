/** Star count for the navbar GitHub link, fetched once per session and cached with a TTL. */

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

/** Resolves to the star count, or null when GitHub is unavailable or rate-limited (the caller hides the count). */
export function fetchGithubStars(repo: string): Promise<number | null> {
  const key = `thally:github-stars:${repo}`
  const cached = readCache(key)
  if (cached !== undefined) return Promise.resolve(cached)
  const pending = inflight.get(key) ?? fetch(`https://api.github.com/repos/${repo}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { stargazers_count?: number } | null) => {
      const stars = typeof data?.stargazers_count === 'number' ? data.stargazers_count : null
      if (stars !== null) {
        try { sessionStorage.setItem(key, JSON.stringify({ stars, at: Date.now() })) } catch { /* storage may be blocked */ }
      }
      return stars
    })
    .catch(() => null)
  inflight.set(key, pending)
  return pending
}
