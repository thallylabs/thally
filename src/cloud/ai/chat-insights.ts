import { getStorage } from '@/lib/storage'
import { aggregateAnalytics } from '@/cloud/analytics/store'
import type { AnalyticsSummary } from '@/lib/analytics/types'
import type { ContentGap } from '@/lib/cloud-bridge/types'

const STREAM = 'chat_insight'

/** Top cosine below this ≈ the docs didn't really answer the question. */
export const WEAK_SCORE = 0.35

export interface ChatInsight {
  question: string
  chunkCount: number
  topScore: number
  slugs: Array<string>
  tier: string
  weak: boolean
}

/**
 * Record one chat exchange for insights — fire-and-forget, never blocks or fails
 * the chat. Opt out with THALLY_CHAT_INSIGHTS=off.
 */
export function recordChatInsight(insight: ChatInsight): void {
  if ((process.env.THALLY_CHAT_INSIGHTS ?? process.env.DOX_CHAT_INSIGHTS) === 'off') return
  void getStorage()
    .appendEvent(STREAM, { ...insight })
    .catch(() => {
      // insights are best-effort
    })
}

export type { ContentGap }

/**
 * The unified content-gap list: questions the AI chat couldn't answer (weak
 * retrieval) + search terms that returned nothing (C2). The single place to see
 * "what do people want that the docs don't cover."
 */
export async function getContentGaps(
  zeroResults?: AnalyticsSummary['search']['zeroResults'],
  limit = 20,
): Promise<Array<ContentGap>> {
  const gaps: Array<ContentGap> = []

  try {
    const events = await getStorage().queryEvents({ stream: STREAM, limit: 500 })
    const weak = new Map<string, number>()
    for (const event of events) {
      if (event.data.weak !== true) continue
      const q = String(event.data.question ?? '').trim().toLowerCase()
      if (q) weak.set(q, (weak.get(q) ?? 0) + 1)
    }
    for (const [term, count] of weak) gaps.push({ term, source: 'chat', count })
  } catch {
    // no store / empty — fine
  }

  try {
    // Reuse the caller's already-computed search summary when provided (the admin
    // route passes it) rather than re-running a full analytics aggregation.
    const zeros = zeroResults ?? (await aggregateAnalytics('30d')).search.zeroResults
    for (const zero of zeros) gaps.push({ term: zero.term, source: 'search', count: zero.count })
  } catch {
    // analytics unavailable — fine
  }

  return gaps.sort((a, b) => b.count - a.count).slice(0, limit)
}
