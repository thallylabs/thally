/**
 * The engine ↔ cloud contract (notes/thally-architecture-plan.md §3).
 *
 * Engine code (everything outside `src/cloud/`) may consume cloud-tier features
 * ONLY through these interfaces, resolved via `getCloud()` in
 * `@/lib/cloud-bridge`. The implementations live under `src/cloud/`; the OSS
 * distribution ships that directory as a no-op stub, so every consumer must
 * tolerate an absent service (locked panel, hidden widget, silent no-op).
 *
 * Types that engine UI renders (DocsTask, ContentGap, TrackedRepoStatus) are
 * DEFINED here — never in `src/cloud/` — so the engine still typechecks when
 * the cloud subtree is stubbed out.
 */

import type { NextRequest } from 'next/server'
import type { AnalyticsEvent, AnalyticsRange, AnalyticsSummary } from '@/lib/analytics/types'

// ---------------------------------------------------------------------------
// Shared data shapes rendered by engine UI
// ---------------------------------------------------------------------------

export interface DocsTask {
  number: number
  title: string
  url: string
  state: 'open' | 'merged' | 'closed'
  author: string
  updatedAt: string
  origin: 'mention' | 'merge' | 'drift' | 'track' | 'manual'
}

export interface ContentGap {
  term: string
  source: 'chat' | 'search'
  count: number
}

export interface TrackedRepoStatus {
  owner: string
  repo: string
  branch: string
  paths: Array<string>
  outputTab?: string
  /** Last PR relayed by the Track webhook (e.g. "#42"), or null before the first merge. */
  lastSyncedPr: string | null
}

/** Tenant scope resolved from a signed runtime grant by the control plane. */
export interface CloudSiteServiceScope {
  orgId: string
  siteId: string
  retentionDays: number
  analyticsEnabled: boolean
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export interface TrackService {
  /** POST /api/track/webhook — merged-PR events from tracked product repos. */
  handleWebhook(request: Request): Promise<Response>
  /** GET /api/admin/github-app — redacted connection status. */
  githubAppStatus(): Promise<Response>
  /** POST /api/admin/github-app — begin the manifest "Connect GitHub" flow. */
  githubAppBegin(request: NextRequest): Promise<Response>
  /** DELETE /api/admin/github-app — disconnect the app. */
  githubAppDisconnect(): Promise<Response>
  /** GET /api/admin/github-app/callback — manifest-flow redirects (auth done by the shell). */
  handleGithubAppCallback(request: NextRequest): Promise<Response>
  /** POST /api/admin/agent-fix — dispatch the docs agent on a readiness subscore. */
  handleAgentFix(request: NextRequest, requester?: string): Promise<Response>
  /** The docs-task queue (agent-authored PRs on the docs repo). */
  getDocsTasks(repoUrl: string | undefined, limit?: number): Promise<Array<DocsTask>>
  /** Track roster + last relayed PR per tracked repo (for the admin Tasks page). */
  getTrackedRepoStatuses(): Promise<Array<TrackedRepoStatus>>
}

export interface AiService {
  /** POST /api/chat — streaming RAG answer over the docs corpus. */
  handleChat(request: NextRequest): Promise<Response>
  /** Whether a chat key is configured (gates rendering the visitor chat widget). */
  isChatConfigured(): boolean
  /** Unified content-gap list (weak chat answers + zero-result searches). */
  getContentGaps(
    zeroResults?: AnalyticsSummary['search']['zeroResults'],
    limit?: number,
  ): Promise<Array<ContentGap>>
  /** Metered answer endpoint for a signed linked-site runtime. */
  handleSiteChat?(request: Request, scope: CloudSiteServiceScope): Promise<Response>
}

export interface AnalyticsService {
  /** Record one analytics event (durable store). */
  trackEvent(event: Omit<AnalyticsEvent, 'id' | 'ts'> & { ts?: number }): Promise<AnalyticsEvent>
  /** Aggregate the event store into the dashboard summary. */
  aggregate(range: AnalyticsRange): Promise<AnalyticsSummary>
  /** Persist an event under a control-plane-resolved tenant scope. */
  trackSiteEvent?(
    scope: CloudSiteServiceScope,
    event: Omit<AnalyticsEvent, 'id' | 'ts'> & { ts?: number },
  ): Promise<void>
  /** Aggregate one owned site's retained events. */
  aggregateSite?(
    scope: CloudSiteServiceScope,
    range: AnalyticsRange,
  ): Promise<AnalyticsSummary>
}

export interface CloudServices {
  track?: TrackService
  ai?: AiService
  analytics?: AnalyticsService
}

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

/**
 * Transitional tiers. `self-hosted-full` is what a deployment with the cloud
 * subtree present gets today; token-backed Thally Cloud plans replace this when the
 * control plane exists (notes/thally-cloud-plan.md §4).
 */
export type PlanTier = 'free' | 'self-hosted-full'

export interface Entitlements {
  plan: PlanTier
  features: {
    aiChat: boolean
    track: boolean
    analytics: boolean
    readinessGate: boolean
    teams: boolean
  }
}
