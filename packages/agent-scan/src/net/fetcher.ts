/**
 * Polite logical fetches on top of a Transport: per-site request budget,
 * robots gate, per-host rate limit, retries with backoff, and manual
 * redirects that are re-guarded and re-gated on every hop.
 *
 * Every transport attempt counts against the budget, including retries,
 * redirect hops and robots.txt fetches.
 */

import { methodology } from '../methodology/methodology.js'
import { allowAllRobots, disallowAllRobots, parseRobots } from '../robots.js'
import type { ErrorCode, FetchOutcome, RateLimiter, RobotsRules, Transport } from '../types.js'
import { isSameSite, robotsPath } from '../url.js'
import { decodeBody, mediaTypeOf, sha256Hex } from './decode.js'
import { checkFetchableUrl } from './guard.js'

/** Why a resource is being fetched; selects the Accept header. */
export type Purpose = 'html' | 'robots' | 'llms' | 'sitemap' | 'well-known' | 'alt-md' | 'alt-json' | 'api'

/** Accept header per purpose. */
export const ACCEPT: Readonly<Record<Purpose, string>> = {
  html: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  robots: 'text/plain, text/markdown;q=0.9, */*;q=0.1',
  llms: 'text/plain, text/markdown;q=0.9, */*;q=0.1',
  sitemap: 'application/xml, text/xml;q=0.9, */*;q=0.1',
  'well-known': 'application/json, */*;q=0.1',
  'alt-md': 'text/markdown, text/plain;q=0.5',
  'alt-json': 'application/json',
  api: 'application/vnd.github+json',
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504])
const RETRY_ERRORS: ReadonlySet<ErrorCode> = new Set(['timeout', 'connection'])
const BACKOFF_MS = [1000, 2000]
const MAX_RETRY_AFTER_SECONDS = 10

/** Robots state for one origin. */
export type RobotsState =
  | { kind: 'ok' | 'missing'; rules: RobotsRules; url: string }
  | { kind: 'unreachable'; rules: RobotsRules; url: string }
  | { kind: 'error'; error: ErrorCode; rules: RobotsRules; url: string }

/** Options for one logical fetch. */
export interface GetOptions {
  purpose: Purpose
  /** Override the purpose's Accept header. */
  accept?: string
  stopAfterBytes?: number
  /** Follow redirects to other sites (docs-root and frame candidate fetches). */
  allowOffsite?: boolean
  /** Extra request headers (lower-case names). Never recorded in captures. */
  headers?: Record<string, string>
  /** Skip the robots gate (robots.txt itself, API calls). */
  skipRobots?: boolean
}

/** A budgeted, robots-aware fetcher bound to one site scan. */
export interface Fetcher {
  get(url: string, options: GetOptions): Promise<FetchOutcome>
  /** Fetch (once) and return the robots rules for an origin. */
  robotsFor(origin: string): Promise<RobotsState>
  /** Transport attempts made so far. */
  readonly used: number
  readonly budget: number
  /** True once any request was refused for budget. */
  readonly exhausted: boolean
}

/** Options for `createFetcher`. */
export interface FetcherOptions {
  transport: Transport
  rateLimiter: RateLimiter
  allowPrivateNetwork: boolean
  sleep: (ms: number) => Promise<void>
  budget?: number
  /** Override the per-attempt timeout (tests). */
  timeoutMs?: number
}

function emptyOutcome(url: string, error: ErrorCode | null, extra: Partial<FetchOutcome> = {}): FetchOutcome {
  return {
    requestedUrl: url,
    finalUrl: url,
    status: null,
    error,
    redirects: 0,
    contentType: null,
    headers: [],
    text: null,
    body: null,
    bodySha256: null,
    bytes: 0,
    truncated: false,
    ...extra,
  }
}

function headerValue(headers: Array<[string, string]>, name: string): string | null {
  const hit = headers.find(([key]) => key === name)
  return hit ? hit[1] : null
}

function retryDelay(headers: Array<[string, string]>, attempt: number): number | null {
  const value = headerValue(headers, 'retry-after')
  if (value !== null && /^\s*\d+\s*$/.test(value)) {
    const seconds = Number(value)
    return seconds <= MAX_RETRY_AFTER_SECONDS ? seconds * 1000 : null
  }
  return BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]
}

/** Create a fetcher with its own request budget and robots cache. */
export function createFetcher(options: FetcherOptions): Fetcher {
  const budget = options.budget ?? methodology.limits.requestsPerSite
  const timeoutMs = options.timeoutMs ?? methodology.limits.timeoutMs
  const robotsCache = new Map<string, Promise<RobotsState>>()
  let used = 0
  let exhausted = false

  async function get(url: string, opts: GetOptions): Promise<FetchOutcome> {
    const guardError = checkFetchableUrl(url, options.allowPrivateNetwork)
    if (guardError) return emptyOutcome(url, guardError)
    let current = url
    let redirects = 0
    for (;;) {
      if (!opts.skipRobots) {
        const parsed = new URL(current)
        const robots = await robotsFor(parsed.origin)
        if (robots.kind === 'error') return emptyOutcome(url, robots.error, { finalUrl: current, redirects })
        if (robots.kind === 'unreachable') {
          return emptyOutcome(url, exhausted && used >= budget ? 'budget_exhausted' : 'robots_unreachable', { finalUrl: current, redirects })
        }
        if (!robots.rules.isAllowed(methodology.robotsProductToken, robotsPath(current))) {
          return emptyOutcome(url, 'robots_disallowed', { finalUrl: current, redirects })
        }
      }
      const response = await attempt(current, opts)
      if ('error' in response) return emptyOutcome(url, response.error, { finalUrl: current, redirects })
      const location = headerValue(response.headers, 'location')
      if (REDIRECT_STATUSES.has(response.status) && location) {
        let next: string
        try {
          next = new URL(location, current).href
        } catch {
          return emptyOutcome(url, 'invalid_url', { finalUrl: current, redirects, status: response.status })
        }
        redirects++
        if (redirects > methodology.limits.maxRedirects) {
          return emptyOutcome(url, 'redirect_limit', { finalUrl: next, redirects, status: response.status })
        }
        const hopError = checkFetchableUrl(next, options.allowPrivateNetwork)
        if (hopError) return emptyOutcome(url, hopError, { finalUrl: next, redirects, status: response.status })
        if (!opts.allowOffsite && !isSameSite(url, next)) {
          return emptyOutcome(url, 'redirect_offsite', { finalUrl: next, redirects, status: response.status })
        }
        current = next
        continue
      }
      const contentTypeHeader = headerValue(response.headers, 'content-type')
      return {
        requestedUrl: url,
        finalUrl: current,
        status: response.status,
        error: null,
        redirects,
        contentType: mediaTypeOf(contentTypeHeader),
        headers: response.headers,
        text: decodeBody(response.body, contentTypeHeader),
        body: response.body,
        bodySha256: sha256Hex(response.body),
        bytes: response.body.byteLength,
        truncated: response.truncated,
      }
    }
  }

  async function attempt(url: string, opts: GetOptions) {
    const host = new URL(url).hostname
    for (let attemptIndex = 0; ; attemptIndex++) {
      if (used >= budget) {
        exhausted = true
        return { error: 'budget_exhausted' as const }
      }
      await options.rateLimiter.acquire(host)
      used++
      const result = await options.transport.request({
        url,
        method: 'GET',
        headers: {
          ...opts.headers,
          'user-agent': methodology.userAgent,
          accept: opts.accept ?? ACCEPT[opts.purpose],
          'accept-encoding': 'gzip, deflate, br',
        },
        timeoutMs,
        maxBodyBytes: methodology.limits.maxBodyBytes,
        ...(opts.stopAfterBytes !== undefined ? { stopAfterBytes: opts.stopAfterBytes } : {}),
      })
      const canRetry = attemptIndex < methodology.limits.retries
      if ('error' in result) {
        if (canRetry && RETRY_ERRORS.has(result.error)) {
          await options.sleep(BACKOFF_MS[attemptIndex] ?? 2000)
          continue
        }
        return result
      }
      if (canRetry && RETRY_STATUSES.has(result.status)) {
        const delay = retryDelay(result.headers, attemptIndex)
        if (delay !== null) {
          await options.sleep(delay)
          continue
        }
      }
      return result
    }
  }

  function robotsFor(origin: string): Promise<RobotsState> {
    let pending = robotsCache.get(origin)
    if (!pending) {
      pending = loadRobots(origin)
      robotsCache.set(origin, pending)
    }
    return pending
  }

  async function loadRobots(origin: string): Promise<RobotsState> {
    const url = `${origin}/robots.txt`
    const outcome = await get(url, { purpose: 'robots', allowOffsite: true, skipRobots: true })
    // RFC 9309: more than five redirects means robots.txt is unavailable (allow all).
    if (outcome.error === 'redirect_limit') return { kind: 'missing', rules: allowAllRobots(), url }
    // Timeouts, connection failures, and failures after a redirect away from
    // the origin mean robots.txt is unreachable: assume complete disallow.
    if (
      outcome.error === 'timeout' || outcome.error === 'connection' || outcome.error === 'budget_exhausted' ||
      (outcome.error && outcome.redirects > 0)
    ) {
      return { kind: 'unreachable', rules: disallowAllRobots(), url }
    }
    if (outcome.error) return { kind: 'error', error: outcome.error, rules: disallowAllRobots(), url }
    const status = outcome.status ?? 0
    if (status === 429 || status >= 500) return { kind: 'unreachable', rules: disallowAllRobots(), url }
    if (status >= 200 && status < 300) return { kind: 'ok', rules: parseRobots(outcome.text ?? ''), url }
    return { kind: 'missing', rules: allowAllRobots(), url }
  }

  return {
    get,
    robotsFor,
    get used() {
      return used
    },
    budget,
    get exhausted() {
      return exhausted
    },
  }
}
