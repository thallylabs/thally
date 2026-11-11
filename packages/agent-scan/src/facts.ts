/**
 * The evidence a scan gathers before any check runs. Gathering is the only
 * networked phase; every check is a pure function of these facts.
 */

import type { PageFacts } from './html.js'
import type { FetchOutcome, RobotsRules } from './types.js'

/** One sampled page and what came back for it. */
export interface PageRecord {
  /** The URL requested for this page. */
  url: string
  isRoot: boolean
  outcome: FetchOutcome
  /** Set only for HTML pages: 200, HTML media type, not truncated, on the docs site. */
  html: PageFacts | null
}

/** A probe that may have been skipped because the request budget ran out. */
export interface ProbeSet {
  attempts: FetchOutcome[]
  hit: FetchOutcome | null
  skippedForBudget: boolean
}

/** One alternate-representation variant tried on the probe page. */
export interface AlternateAttempt {
  variant: 'link_alternate' | 'dot_md' | 'accept_markdown' | 'format_json'
  url: string
  kind: 'markdown' | 'json'
  /** Null when the variant was skipped for budget. */
  outcome: FetchOutcome | null
  valid: boolean
}

/** Everything the checks evaluate. */
export interface SiteFacts {
  docsRoot: string
  robots: { rules: RobotsRules; found: boolean }
  /** Sampled pages in fetch order; the docs root is first. */
  pages: PageRecord[]
  llms: ProbeSet
  llmsFull: ProbeSet
  sitemap: {
    attempts: FetchOutcome[]
    /** URLs of fetched sitemaps that parsed as urlset or sitemapindex. */
    parsed: string[]
    /** Raw `<loc>` URLs (from urlsets) under the docs root, including the root itself. */
    locsUnderRoot: number
    skippedForBudget: boolean
  }
  wellKnown: ProbeSet
  /** The docs root response carried a `Link` header with `rel="mcp"`. */
  rootLinkHeaderMcp: boolean
  alternate: {
    probePage: string
    attempts: AlternateAttempt[]
    hit: AlternateAttempt | null
    /** Title extracted from the hit, before normalization. */
    title: string | null
  }
}
