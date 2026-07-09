/**
 * The docs-task queue (A5). Every docs task the agent produces lands as a PR, so
 * the queue IS the repo's agent-authored pull requests — read from GitHub, no
 * extra storage. Best-effort: returns [] on any error (no repo, rate limit,
 * private repo without a token).
 */

export interface DocsTask {
  number: number
  title: string
  url: string
  state: 'open' | 'merged' | 'closed'
  author: string
  updatedAt: string
  origin: 'mention' | 'merge' | 'drift' | 'track' | 'manual'
}

export function parseRepo(repoUrl: string): { owner: string; repo: string } | null {
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git|\/|$)/i)
  return m ? { owner: m[1], repo: m[2] } : null
}

// Map TaskSource (agent) → the queue's origin. 'cli' has no dedicated chip.
const SOURCE_TO_ORIGIN: Record<string, DocsTask['origin']> = {
  track: 'track',
  drift: 'drift',
  merge: 'merge',
  mention: 'mention',
  cli: 'manual',
}

export function parseOrigin(body: string): DocsTask['origin'] {
  // The authoritative marker is the LAST occurrence of the exact trailer the
  // agent stamps (run.ts): "Drafted by the Dox docs agent (origin: <source>)".
  // Anchoring to that phrase (and taking the last match) prevents a summary that
  // merely quotes "origin: merge" from hijacking the classification.
  const stamps = [...body.matchAll(/Drafted by the Dox docs agent \(origin:\s*(\w+)\)/gi)]
  const marker = stamps.at(-1)?.[1]?.toLowerCase()
  if (marker && marker in SOURCE_TO_ORIGIN) return SOURCE_TO_ORIGIN[marker]
  // Pre-marker / hand-authored PRs: fall back to the fuzzy heuristics.
  if (/drift|stale/i.test(body)) return 'drift'
  if (/merged in|merge to main|@[\w-]+@[0-9a-f]{7,}/i.test(body)) return 'merge'
  if (/requested by/i.test(body)) return 'mention'
  return 'manual'
}

interface GhPull {
  number: number
  title: string
  html_url: string
  state: string
  merged_at: string | null
  updated_at: string
  body: string | null
  user: { login: string } | null
}

export async function getDocsTasks(repoUrl: string | undefined, limit = 25): Promise<Array<DocsTask>> {
  if (!repoUrl) return []
  const parsed = parseRepo(repoUrl)
  if (!parsed) return []

  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  const token = process.env.DOX_GITHUB_TOKEN?.trim() || process.env.DOX_TASKS_TOKEN?.trim()
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls?state=all&per_page=50&sort=updated&direction=desc`,
      { headers, next: { revalidate: 60 } },
    )
  } catch {
    return []
  }
  if (!res.ok) return []

  let pulls: Array<GhPull>
  try {
    pulls = (await res.json()) as Array<GhPull>
  } catch {
    return []
  }

  const tasks: Array<DocsTask> = []
  for (const pr of pulls) {
    const body = pr.body ?? ''
    // Only the docs agent's PRs are tasks (it stamps this line into the body).
    if (!/dox docs agent/i.test(body)) continue
    tasks.push({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : 'open',
      author: pr.user?.login ?? 'unknown',
      updatedAt: pr.updated_at,
      origin: parseOrigin(body),
    })
    if (tasks.length >= limit) break
  }
  return tasks
}
