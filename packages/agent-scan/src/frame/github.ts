/**
 * GitHub repository search for the sample frame: the top repositories by
 * stars, paged at 100 per request, paced under the search rate limit. The
 * token, when present, is sent only to the GitHub API and is never logged or
 * captured.
 */

import { methodology } from '../methodology/methodology.js'
import { decodeBody } from '../net/decode.js'
import type { Transport } from '../types.js'

/** The repository fields the frame uses. */
export interface GitHubRepo {
  id: number
  full_name: string
  stargazers_count: number
  archived: boolean
  homepage: string | null
}

/** Options for `searchTopRepos`. */
export interface SearchOptions {
  transport: Transport
  limit: number
  token?: string
  sleep: (ms: number) => Promise<void>
  /** Milliseconds clock for rate-limit resets; default `Date.now`. */
  nowMs?: () => number
  /** Override the API base (tests). The token is never sent to an override. */
  apiBase?: string
}

/** Search result plus counts for `frame-meta.json`. */
export interface SearchResult {
  query: string
  totalCount: number
  fetched: number
  repos: GitHubRepo[]
}

const GITHUB_API = 'https://api.github.com'

/** The search query the frame uses. */
export const FRAME_QUERY = 'stars:>1000'
const PAGE_SIZE = 100
const MAX_RESULTS = 1000
const MAX_WAIT_MS = 70_000

function header(headers: Array<[string, string]>, name: string): string | null {
  return headers.find(([key]) => key === name)?.[1] ?? null
}

/**
 * Fetch up to `limit` (at most 1,000, the API's search cap) repositories in
 * star order, de-duplicated by id because star counts shift between pages.
 */
export async function searchTopRepos(options: SearchOptions): Promise<SearchResult> {
  const limit = Math.min(MAX_RESULTS, Math.max(1, Math.floor(options.limit)))
  const nowMs = options.nowMs ?? Date.now
  const apiBase = options.apiBase ?? GITHUB_API
  // The token is only ever sent to the real GitHub API host.
  const token = apiBase === GITHUB_API ? options.token : undefined
  const pacingMs = token ? 2100 : 6500
  const seen = new Set<number>()
  const repos: GitHubRepo[] = []
  let totalCount = 0
  let fetched = 0
  const pages = Math.ceil(limit / PAGE_SIZE)
  for (let page = 1; page <= pages; page++) {
    if (page > 1) await options.sleep(pacingMs)
    const url = `${apiBase}/search/repositories?q=${encodeURIComponent(FRAME_QUERY)}&sort=stars&order=desc&per_page=${PAGE_SIZE}&page=${page}`
    let body: { total_count?: number; items?: GitHubRepo[] } | null = null
    for (let attempt = 0; attempt <= 2; attempt++) {
      const response = await options.transport.request({
        url,
        method: 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': methodology.userAgent,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        timeoutMs: methodology.limits.timeoutMs,
        maxBodyBytes: methodology.limits.maxBodyBytes,
      })
      if ('error' in response) throw new Error(`GitHub search failed: ${response.error}`)
      if ((response.status === 403 || response.status === 429) && attempt < 2) {
        const retryAfter = Number(header(response.headers, 'retry-after'))
        const reset = Number(header(response.headers, 'x-ratelimit-reset'))
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Number.isFinite(reset) && reset > 0 ? reset * 1000 - nowMs() : pacingMs
        await options.sleep(Math.min(MAX_WAIT_MS, Math.max(1000, wait)))
        continue
      }
      if (response.status !== 200) throw new Error(`GitHub search returned HTTP ${response.status}`)
      body = JSON.parse(decodeBody(response.body, header(response.headers, 'content-type')))
      break
    }
    if (!body) throw new Error('GitHub search is rate limited; set GITHUB_TOKEN or retry later.')
    totalCount = body.total_count ?? totalCount
    const items = body.items ?? []
    fetched += items.length
    for (const item of items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      repos.push({
        id: item.id,
        full_name: item.full_name,
        stargazers_count: item.stargazers_count,
        archived: item.archived === true,
        homepage: item.homepage ?? null,
      })
      if (repos.length >= limit) break
    }
    if (repos.length >= limit || items.length < PAGE_SIZE) break
  }
  return { query: FRAME_QUERY, totalCount, fetched, repos }
}
