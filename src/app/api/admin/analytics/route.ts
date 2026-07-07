import { NextResponse } from 'next/server'
import { type NextRequest } from 'next/server'
import { aggregateAnalytics } from '@/lib/analytics/store'
import { isAdminDashboardEnabled } from '@/data/docs'
import { requireCapabilityFromRequest } from '@/lib/auth/rbac'
import { getContentGaps } from '@/lib/chat-insights'
import type { AnalyticsRange } from '@/lib/analytics/types'

export const runtime = 'nodejs'

const VALID_RANGES: ReadonlyArray<AnalyticsRange> = ['7d', '30d', '90d', '6mo', '1y', '3y', 'all']

function parseRange(value: string | null): AnalyticsRange {
  return VALID_RANGES.includes(value as AnalyticsRange) ? (value as AnalyticsRange) : '30d'
}

export async function GET(request: NextRequest) {
  if (!isAdminDashboardEnabled()) {
    return NextResponse.json({ error: 'Admin dashboard is not configured.' }, { status: 503 })
  }

  // RBAC: any admin role (viewer+) may read analytics. Handles OIDC + break-glass.
  const session = await requireCapabilityFromRequest(request, 'view_analytics')
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const range = parseRange(request.nextUrl.searchParams.get('range'))
  const summary = await aggregateAnalytics(range)
  // Feed the already-computed zero-result terms in — no second aggregation.
  const contentGaps = await getContentGaps(summary.search.zeroResults)
  return NextResponse.json({ ...summary, contentGaps })
}
