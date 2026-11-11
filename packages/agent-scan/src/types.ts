/**
 * Public contracts for the agent-readiness scanner.
 *
 * Every value that reaches a `SiteResult` is deterministic for a given set of
 * HTTP responses: error reasons are closed enums rather than OS-specific
 * messages, and timestamps come only from `ScanOptions.now`.
 */

/** One of the six methodology categories. */
export type CategoryId = 'discovery' | 'identity' | 'structure' | 'retrieval' | 'trust' | 'parity'
/** Outcome of a single check. */
export type CheckStatus = 'pass' | 'fail' | 'not_applicable'
/** Letter grade derived from the 0–100 score. */
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'

/**
 * Closed set; never free text, so results stay byte-stable across OSes.
 * `decode` means the body could not be decompressed as its Content-Encoding
 * declared. `request_cap` means a probe group (sitemaps) used up its own
 * request allowance; it never applies to a whole site.
 */
export type ErrorCode =
  | 'invalid_url' | 'private_address' | 'dns' | 'timeout' | 'connection' | 'tls'
  | 'http_status' | 'not_html' | 'body_too_large' | 'redirect_limit' | 'redirect_offsite'
  | 'robots_disallowed' | 'robots_unreachable' | 'budget_exhausted' | 'capture_miss' | 'decode'
  | 'request_cap'

/**
 * Why a check did not apply. `site_not_scanned` marks every check on a site
 * whose status is `error` or `skipped` for a reason other than robots.
 */
export type NotApplicableReason =
  | 'no_alternate' | 'no_comparable_pages' | 'no_html_pages' | 'budget' | 'robots_disallowed'
  | 'site_not_scanned'

/** One HTTP exchange; the only network seam. */
export interface TransportRequest {
  /** Absolute URL, already guarded. */
  url: string
  method: 'GET' | 'HEAD'
  /** Lower-case header names. */
  headers: Record<string, string>
  timeoutMs: number
  /** Cap on decompressed bytes. */
  maxBodyBytes: number
  /** Prefix read; `truncated` is true when more bytes were available. */
  stopAfterBytes?: number
  /**
   * Endpoint probe: the response is judged by its status line and headers.
   * A `text/event-stream` response ends as soon as its headers arrive, and a
   * timeout after the headers returns what arrived (`truncated`) instead of
   * an error.
   */
  probe?: boolean
}

/** Response to one `TransportRequest`. Redirects are never followed here. */
export interface TransportResponse {
  url: string
  status: number
  /** Lower-case names, sorted by name; repeated headers keep arrival order. */
  headers: Array<[string, string]>
  /** Decompressed body bytes, at most the applicable cap. */
  body: Uint8Array
  /** True when the body hit `maxBodyBytes` or `stopAfterBytes`. */
  truncated: boolean
}

/** A failed exchange, reduced to a stable code. */
export interface TransportError { error: ErrorCode }

/** Performs single HTTP exchanges. Implementations must not follow redirects or retry. */
export interface Transport {
  request(req: TransportRequest): Promise<TransportResponse | TransportError>
}

/** Spaces out request starts per host. */
export interface RateLimiter { acquire(host: string): Promise<void> }

/** Parsed robots.txt rules. */
export interface RobotsRules {
  /** RFC 9309 longest-match; ties -> Allow. `path` includes the query. */
  isAllowed(userAgent: string, path: string): boolean
  /** Absolute URLs from `Sitemap:` lines, file order. */
  sitemaps: string[]
}

/** Result of one logical fetch after redirects, retries and robots gating. */
export interface FetchOutcome {
  requestedUrl: string
  finalUrl: string
  /** Null when no response was received. */
  status: number | null
  error: ErrorCode | null
  /** Redirect hops followed. */
  redirects: number
  /** Media type only, lower-case. */
  contentType: string | null
  headers: Array<[string, string]>
  /** Decoded body; null on error or when there is no body. */
  text: string | null
  /** Raw decompressed body; null on error. */
  body: Uint8Array | null
  bodySha256: string | null
  bytes: number
  truncated: boolean
}

/** Options for `scanSite`. */
export interface ScanOptions {
  /** Default: `createNodeTransport({ allowPrivateNetwork })`. */
  transport?: Transport
  /** Default: a process-wide per-host limiter (1000 ms between request starts). */
  rateLimiter?: RateLimiter
  /** Default false. Only for local testing. */
  allowPrivateNetwork?: boolean
  /** Record every exchange under this directory. */
  captureDir?: string
  /** Store raw bodies in the capture. Default: a deterministic 10% of sites. */
  captureBodies?: boolean
  /** `scannedAt` source; replay supplies the captured value. */
  now?: () => Date
  /** Retry backoff sleep. Default: a real timer. Replay and tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>
  /** A known Thally-hosted value from the frame; default is detected. */
  thallyHostedOverride?: boolean
}

/** One evaluated check. */
export interface CheckResult {
  /** Methodology id, e.g. `discovery.llms_txt`. */
  id: string
  category: CategoryId
  /** False means reported, never affects score. */
  scored: boolean
  status: CheckStatus
  /** 0..1 used for scoring; null when not_applicable. Binary checks are 0 or 1. */
  value: number | null
  /** Page-rate checks only. */
  pages?: { passed: number; applicable: number }
  notApplicableReason?: NotApplicableReason
  /** URLs that justify the result (failing pages first, then passing), max 10, sample order. */
  evidence: string[]
  /** Short deterministic human sentence. */
  detail: string
}

/** Score for one methodology category. */
export interface CategoryScore {
  id: CategoryId
  /** From the methodology. */
  weight: number
  /** False when every scored check is not applicable. */
  applicable: boolean
  /** Mean of applicable scored check values x 100, rounded to 1 decimal; null when not applicable. */
  score: number | null
}

/** Descriptive docs-platform detection. */
export interface PlatformGuess {
  platform: 'thally' | 'mintlify' | 'gitbook' | 'docusaurus' | 'readme' | 'fern' | 'readthedocs'
    | 'mkdocs' | 'sphinx' | 'vitepress' | 'starlight' | 'nextra' | 'nextjs' | 'unknown'
  confidence: 'high' | 'low'
  /** For example `meta:generator=Docusaurus v3.5.2`. */
  signals: string[]
}

/** The full result for one site. */
export interface SiteResult {
  methodology: { id: 'thally-agent-scan'; version: '1.0' }
  /** The scanner package version. */
  scannerVersion: string
  /** URL as given. */
  input: string
  /** Normalized, trailing slash on directory roots. */
  docsRoot: string | null
  status: 'ok' | 'error' | 'skipped'
  /** Set when status is not `ok`. */
  reason: ErrorCode | null
  /** ISO 8601, from `options.now`. */
  scannedAt: string
  sample: {
    source: 'sitemap' | 'bfs' | 'root_only'
    /** URLs under the docs root before sampling. */
    sitemapUrlCount: number
    /** Sampled URLs including the docs root, in fetch order. */
    pages: string[]
    droppedForBudget: string[]
  }
  requests: { used: number; budget: number; exhausted: boolean }
  /** Every methodology check, methodology order. */
  checks: CheckResult[]
  /** Methodology order. */
  categories: CategoryScore[]
  /** 0..100 integer; null when status is not `ok`. */
  score: number | null
  grade: Grade | null
  platform: PlatformGuess
  /** "Runs the Thally engine"; cannot distinguish managed from self-hosted. */
  thallyHosted: boolean
}
