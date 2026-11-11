/**
 * `scanSite`: gather facts over HTTP, evaluate every check, score, and
 * assemble a `SiteResult`. Site-level failures become `error` or `skipped`
 * results; `scanSite` throws only on programmer errors.
 */

import { join } from 'node:path'

import { evaluateChecks, unscannedChecks } from './checks/index.js'
import { gatherSite } from './gather.js'
import { methodology } from './methodology/methodology.js'
import { createCaptureRecorder, createReplayTransport, defaultCaptureBodies, readCaptureMeta, siteKeyFor, writeCapture } from './net/capture.js'
import { createFetcher } from './net/fetcher.js'
import { createRateLimiter, noopRateLimiter, realSleep } from './net/rate-limiter.js'
import { createNodeTransport } from './net/transport.js'
import { detectPlatform } from './platform.js'
import { scoreChecks } from './score.js'
import type { RateLimiter, ScanOptions, SiteResult } from './types.js'
import { scannerVersion } from './version.js'

let sharedLimiter: RateLimiter | null = null

/** The process-wide per-host limiter shared by every scan that does not inject one. */
export function defaultRateLimiter(): RateLimiter {
  sharedLimiter ??= createRateLimiter({ minIntervalMs: methodology.limits.minIntervalMsPerHost })
  return sharedLimiter
}

/** Internal knobs for tests; not part of the public options. */
export interface InternalScanOptions extends ScanOptions {
  /** Per-attempt timeout override. */
  timeoutMs?: number
}

/**
 * Scan one documentation site and return its typed result. Never throws for
 * network, HTTP or content failures: those produce `status: 'error'` or
 * `'skipped'` with a stable `reason`.
 */
export async function scanSite(url: string, options: ScanOptions = {}): Promise<SiteResult> {
  const internal = options as InternalScanOptions
  const allowPrivateNetwork = options.allowPrivateNetwork ?? false
  const now = options.now ?? (() => new Date())
  const baseTransport = options.transport ?? createNodeTransport({ allowPrivateNetwork })
  const recorder = options.captureDir ? createCaptureRecorder(baseTransport) : null
  const fetcher = createFetcher({
    transport: recorder?.transport ?? baseTransport,
    rateLimiter: options.rateLimiter ?? defaultRateLimiter(),
    allowPrivateNetwork,
    sleep: options.sleep ?? realSleep,
    ...(internal.timeoutMs !== undefined ? { timeoutMs: internal.timeoutMs } : {}),
  })

  const gathered = await gatherSite(url, fetcher, allowPrivateNetwork)
  const scannedAt = now().toISOString()
  const requests = { used: fetcher.used, budget: fetcher.budget, exhausted: fetcher.exhausted }
  let result: SiteResult
  if (!gathered.ok) {
    result = {
      methodology: { id: methodology.id, version: methodology.version },
      scannerVersion,
      input: url,
      docsRoot: gathered.docsRoot,
      status: gathered.status,
      reason: gathered.reason,
      scannedAt,
      sample: { source: 'root_only', sitemapUrlCount: 0, pages: [], droppedForBudget: [] },
      requests,
      checks: unscannedChecks(gathered.reason === 'robots_disallowed' ? 'robots_disallowed' : 'site_not_scanned'),
      categories: methodology.categories.map((category) => ({ id: category.id, weight: category.weight, applicable: false, score: null })),
      score: null,
      grade: null,
      platform: { platform: 'unknown', confidence: 'low', signals: [] },
      thallyHosted: options.thallyHostedOverride ?? false,
    }
  } else {
    const checks = evaluateChecks(gathered.facts)
    const { categories, score, grade } = scoreChecks(checks)
    const platform = detectPlatform({ url: gathered.rootFinalUrl, headers: gathered.rootHeaders, page: gathered.facts.pages[0].html })
    result = {
      methodology: { id: methodology.id, version: methodology.version },
      scannerVersion,
      input: url,
      docsRoot: gathered.facts.docsRoot,
      status: 'ok',
      reason: null,
      scannedAt,
      sample: gathered.sample,
      requests,
      checks,
      categories,
      score,
      grade,
      platform,
      thallyHosted: options.thallyHostedOverride ?? (platform.platform === 'thally' && platform.confidence === 'high'),
    }
  }

  if (recorder && options.captureDir) {
    const siteKey = siteKeyFor(url)
    writeCapture(join(options.captureDir, siteKey), {
      schema: 1,
      input: url,
      scannedAt,
      methodology: { id: methodology.id, version: methodology.version },
      scannerVersion,
      bodies: options.captureBodies ?? defaultCaptureBodies(siteKey),
    }, recorder)
  }
  return result
}

/** Options for `replaySite`. */
export interface ReplayOptions {
  /** Needed when the capture was recorded against a private or loopback host. */
  allowPrivateNetwork?: boolean
}

/**
 * Re-run a scan from a capture directory recorded with bodies. Uses the
 * captured `scannedAt`, no rate limiting and no retry sleeps, so the result
 * is byte-identical to the original scan under `stableStringify`.
 */
export async function replaySite(captureSiteDir: string, options: ReplayOptions = {}): Promise<SiteResult> {
  const meta = readCaptureMeta(captureSiteDir)
  if (meta.scannerVersion !== scannerVersion) {
    throw new Error(`Capture was recorded by scanner ${meta.scannerVersion}; this is ${scannerVersion}.`)
  }
  return scanSite(meta.input, {
    transport: createReplayTransport(captureSiteDir),
    rateLimiter: noopRateLimiter(),
    sleep: async () => {},
    now: () => new Date(meta.scannedAt),
    allowPrivateNetwork: options.allowPrivateNetwork ?? false,
  })
}
