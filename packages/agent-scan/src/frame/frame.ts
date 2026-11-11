/**
 * Build and freeze the sample frame: the top repositories by stars, each
 * with a docs-root decision and reason, written as `sample.csv` plus
 * `frame-meta.json`. Repositories are resolved in star-rank order so the
 * first repository wins when several share one docs root.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { methodology } from '../methodology/methodology.js'
import { createCaptureRecorder, writeCapture } from '../net/capture.js'
import { createFetcher } from '../net/fetcher.js'
import { realSleep } from '../net/rate-limiter.js'
import { createNodeTransport } from '../net/transport.js'
import { toCsv } from '../output/csv.js'
import { stableStringify } from '../output/stable-json.js'
import { defaultRateLimiter } from '../scan.js'
import type { RateLimiter, Transport } from '../types.js'
import { equalityKey } from '../url.js'
import { scannerVersion } from '../version.js'
import { resolveDocsRoot, type FrameReason } from './docs-root.js'
import { searchTopRepos } from './github.js'

/** One `sample.csv` row. */
export interface FrameRow {
  rank: number
  repo: string
  repo_id: number
  stars: number
  archived: boolean
  homepage: string
  docs_root: string
  decision: 'include' | 'exclude'
  reason: FrameReason
  duplicate_of: string
  frozen_on: string
}

/** Options for `buildFrame`. */
export interface FrameOptions {
  /** Output path for `sample.csv`; `frame-meta.json` is written beside it. */
  out: string
  /** Repositories to consider; default and maximum 1,000. */
  limit?: number
  /** GitHub token; optional, raises the search rate limit. */
  token?: string
  transport?: Transport
  rateLimiter?: RateLimiter
  allowPrivateNetwork?: boolean
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  /** Record every exchange (search and resolution) under `<dir>/frame`. */
  captureDir?: string
  apiBase?: string
  /** Called after each repository is resolved. */
  onRow?: (row: FrameRow) => void
}

/** Per-repository request budget for docs-root resolution. */
export const FRAME_REPO_BUDGET = 8

/** `sample.csv` columns, in order. */
export const FRAME_COLUMNS: Array<keyof FrameRow> = [
  'rank', 'repo', 'repo_id', 'stars', 'archived', 'homepage', 'docs_root', 'decision', 'reason', 'duplicate_of', 'frozen_on',
]

/** Build the frame, write `sample.csv` and `frame-meta.json`, and return the rows. */
export async function buildFrame(options: FrameOptions): Promise<FrameRow[]> {
  const allowPrivateNetwork = options.allowPrivateNetwork ?? false
  const sleep = options.sleep ?? realSleep
  const now = options.now ?? (() => new Date())
  const baseTransport = options.transport ?? createNodeTransport({ allowPrivateNetwork })
  const recorder = options.captureDir ? createCaptureRecorder(baseTransport) : null
  const transport = recorder?.transport ?? baseTransport
  const rateLimiter = options.rateLimiter ?? defaultRateLimiter()
  const frozenAt = now()
  const frozenOn = frozenAt.toISOString().slice(0, 10)

  const search = await searchTopRepos({
    transport,
    limit: options.limit ?? 1000,
    token: options.token,
    sleep,
    nowMs: () => now().getTime(),
    ...(options.apiBase ? { apiBase: options.apiBase } : {}),
  })

  const rows: FrameRow[] = []
  const firstByRoot = new Map<string, string>()
  for (const [index, repo] of search.repos.entries()) {
    const fetcher = createFetcher({ transport, rateLimiter, allowPrivateNetwork, sleep, budget: FRAME_REPO_BUDGET })
    const resolution = await resolveDocsRoot(repo.homepage, fetcher, allowPrivateNetwork)
    const row: FrameRow = {
      rank: index + 1,
      repo: repo.full_name,
      repo_id: repo.id,
      stars: repo.stargazers_count,
      archived: repo.archived,
      homepage: repo.homepage ?? '',
      docs_root: resolution.docsRoot ?? '',
      decision: resolution.decision,
      reason: resolution.reason,
      duplicate_of: '',
      frozen_on: frozenOn,
    }
    if (resolution.decision === 'include' && resolution.docsRoot) {
      const key = equalityKey(resolution.docsRoot)
      const first = firstByRoot.get(key)
      if (first) {
        row.decision = 'exclude'
        row.reason = 'duplicate_docs_root'
        row.duplicate_of = first
      } else firstByRoot.set(key, repo.full_name)
    }
    rows.push(row)
    options.onRow?.(row)
  }

  mkdirSync(dirname(options.out), { recursive: true })
  writeFileSync(options.out, toCsv([FRAME_COLUMNS, ...rows.map((row) => FRAME_COLUMNS.map((column) => row[column]))]))
  const meta = {
    frozenOn,
    query: search.query,
    totalCount: search.totalCount,
    fetched: search.fetched,
    unique: search.repos.length,
    limit: options.limit ?? 1000,
    included: rows.filter((row) => row.decision === 'include').length,
    methodology: { id: methodology.id, version: methodology.version },
    scannerVersion,
  }
  writeFileSync(join(dirname(options.out), 'frame-meta.json'), `${JSON.stringify(JSON.parse(stableStringify(meta)), null, 2)}\n`)
  if (recorder && options.captureDir) {
    writeCapture(join(options.captureDir, 'frame'), {
      schema: 1,
      input: 'github-search',
      scannedAt: frozenAt.toISOString(),
      methodology: { id: methodology.id, version: methodology.version },
      scannerVersion,
      bodies: true,
    }, recorder)
  }
  return rows
}
