/**
 * Public entry point for `@thallylabs/agent-scan`, a black-box scanner that
 * applies the `thally-agent-scan` methodology to any public documentation
 * site over plain HTTP.
 */

export { methodology, gradeFor, validateMethodology } from './methodology/methodology.js'
export type { Methodology, MethodologyCategory, MethodologyCheck } from './methodology/methodology.js'
export { scanSite, replaySite } from './scan.js'
export type { ReplayOptions } from './scan.js'
export { scoreChecks } from './score.js'
export type { ScoreSummary } from './score.js'
export { parseRobots } from './robots.js'
export { parseSitemap } from './sitemap.js'
export type { ParsedSitemap } from './sitemap.js'
export { eligibleUrls, pickSample } from './sample.js'
export { createNodeTransport } from './net/transport.js'
export type { NodeTransportOptions, Resolver } from './net/transport.js'
export { createReplayTransport, siteKeyFor } from './net/capture.js'
export type { CaptureMeta, CapturedExchange } from './net/capture.js'
export { createRateLimiter, noopRateLimiter } from './net/rate-limiter.js'
export type { RateLimiterOptions } from './net/rate-limiter.js'
export { runBatch, readBatchInputs } from './batch.js'
export type { BatchOptions, BatchReport, CaptureBodiesSetting } from './batch.js'
export { buildFrame } from './frame/frame.js'
export type { FrameOptions, FrameRow } from './frame/frame.js'
export type { FrameReason } from './frame/docs-root.js'
export { stableStringify } from './output/stable-json.js'
export { summarize } from './output/summary.js'
export { scannerVersion } from './version.js'
export type * from './types.js'
