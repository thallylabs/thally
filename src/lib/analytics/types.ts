import type { AgentSignal, VisitorType } from '@/lib/traffic-classifier'

export type AnalyticsEventType =
  | 'page_view'
  | 'feedback'
  | 'chat_message'
  | 'discovery'
  | 'api_fetch'
  | 'search_query'

export interface AnalyticsEvent {
  id: string
  ts: number
  type: AnalyticsEventType
  path: string
  slug?: string
  visitorType?: VisitorType
  agentSignal?: AgentSignal
  format?: string
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
  topPages: {
    human: Array<{ path: string; views: number }>
    agent: Array<{ path: string; views: number }>
  }
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
