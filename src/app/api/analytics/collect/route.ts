import { type NextRequest, NextResponse } from 'next/server'
import { trackAnalyticsEvent } from '@/lib/analytics/store'
import { getInternalAnalyticsSecret } from '@/lib/admin/auth'
import { isAnalyticsEnabled } from '@/data/docs'
import { getAdminSettings } from '@/lib/admin/settings'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-thally-analytics-secret')
  if (secret !== getInternalAnalyticsSecret()) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Respect the admin's live analytics toggle (defaults to the docs.json setting, on).
  const enabled = (await getAdminSettings()).analyticsEnabled ?? isAnalyticsEnabled()
  if (!enabled) return NextResponse.json({ ok: true, skipped: true })

  try {
    const body = await request.json()
    await trackAnalyticsEvent(body)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
}
