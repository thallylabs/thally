import { type NextRequest, NextResponse } from 'next/server'
import { getInternalAnalyticsSecret } from '@/lib/admin/auth'
import { isAnalyticsEnabled } from '@/data/docs'
import { getAdminSettings } from '@/lib/admin/settings'
import { getCloud } from '@/lib/cloud-bridge'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-thally-analytics-secret')
  if (secret !== getInternalAnalyticsSecret()) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // No analytics service on this deployment (OSS free tier) — accept + drop.
  const analytics = getCloud()?.analytics
  if (!analytics) return NextResponse.json({ ok: true, skipped: true })

  // Respect the admin's live analytics toggle (defaults to the docs.json setting, on).
  const enabled = (await getAdminSettings()).analyticsEnabled ?? isAnalyticsEnabled()
  if (!enabled) return NextResponse.json({ ok: true, skipped: true })

  try {
    const body = await request.json()
    await analytics.trackEvent(body)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
}
