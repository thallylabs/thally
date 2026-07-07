import { NextResponse, type NextRequest } from 'next/server'
import { trackAnalyticsEvent } from '@/lib/analytics/store'
import { classifyRequest } from '@/lib/traffic-classifier'

export const runtime = 'nodejs'

/**
 * Public beacon for the client command palette to record searches and result
 * clicks. Best-effort and low-stakes (like /api/feedback) — no secret required.
 */
export async function POST(request: NextRequest) {
  let body: { query?: unknown; resultCount?: unknown; clickedSlug?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 200) : ''
  if (!query) return NextResponse.json({ ok: true })

  const classification = classifyRequest(request, '/api/search/track')

  try {
    await trackAnalyticsEvent({
      type: 'search_query',
      path: '/api/search',
      query,
      resultCount: typeof body.resultCount === 'number' ? body.resultCount : undefined,
      clickedSlug: typeof body.clickedSlug === 'string' ? body.clickedSlug.slice(0, 200) : undefined,
      visitorType: classification.visitorType,
      agentSignal: classification.agentSignal,
    })
  } catch {
    // analytics is best-effort — never fail the beacon
  }

  return NextResponse.json({ ok: true })
}
