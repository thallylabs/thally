import type { AgentSignal, VisitorType } from '@/lib/traffic-classifier'

export type AnalyticsEventType = 'page_view' | 'feedback' | 'chat_message' | 'discovery' | 'api_fetch' | 'search_query'

export interface AnalyticsEvent {
  id: string
  ts: number
  type: AnalyticsEventType
  path: string
  slug?: string
  visitorType?: VisitorType
  agentSignal?: AgentSignal
  format?: string
  /** Site/day-scoped HMAC; never a raw IP, User-Agent, cookie, or account id. */
  visitorKey?: string
  /** External hostname only. Full referrer paths and queries are not retained. */
  referrerDomain?: string
  referer?: string
  vote?: 'yes' | 'no'
  page?: string
  /** Optional written feedback submitted with a page rating. */
  message?: string
  /** search_query: the search term. */
  query?: string
  /** search_query: number of results returned (0 = a content gap). */
  resultCount?: number
  /** search_query: the page slug the user clicked from the results, if any. */
  clickedSlug?: string
}

export type AnalyticsRange = '7d' | '30d' | '90d' | '6mo' | '1y' | '3y' | 'all'

export interface DailyTrafficPoint {
  date: string
  human: number
  agent: number
  total: number
}

export interface AnalyticsSummary {
  range: AnalyticsRange
  totals: {
    pageViews: number
    humanViews: number
    agentViews: number
    feedbackYes: number
    feedbackNo: number
    chatMessages: number
    discoveryHits: number
  }
  dailyTraffic: Array<DailyTrafficPoint>
  humanAudience: {
    /** Daily anonymous visitors. A returning reader is new after UTC midnight. */
    visitors: number
    /** Human visits separated by at least 30 minutes of inactivity. */
    visits: number
    viewsPerVisit: number
    /** Percentage of visits containing exactly one page view. */
    bounceRate: number
    /** Human page views carrying the privacy-safe visitor key. */
    identifiedViews: number
    /** identifiedViews / humanViews; consumers must expose partial coverage. */
    identityCoverage: number
  }
  topPages: {
    human: Array<{ path: string; views: number }>
    agent: Array<{ path: string; views: number }>
  }
  topReferrers: Array<{ source: string; visits: number }>
  entryPages: Array<{ path: string; visits: number }>
  agentSignals: Array<{ signal: string; count: number }>
  recentFeedback: Array<{ ts: number; page: string; vote: 'yes' | 'no' }>
  search: {
    totalSearches: number
    /** Searches that returned a result and were clicked / total searches. */
    clickThroughRate: number
    topTerms: Array<{ term: string; count: number }>
    /** Terms that returned zero results — the content-gap goldmine. */
    zeroResults: Array<{ term: string; count: number }>
  }
}
