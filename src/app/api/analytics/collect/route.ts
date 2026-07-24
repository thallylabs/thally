import { type NextRequest, NextResponse } from 'next/server'
import { getInternalAnalyticsSecret } from '@/lib/admin/auth'
import { isAnalyticsEnabled } from '@/data/docs'
import { getAdminSettings } from '@/lib/admin/settings'
import { recordAnalyticsEvent } from '@/lib/cloud-bridge'
import { getCloudSiteConfig } from '@/lib/cloud-link/client'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-thally-analytics-secret')
  if (secret !== getInternalAnalyticsSecret()) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const cloudConfig = await getCloudSiteConfig(request.nextUrl.origin)
  if (cloudConfig) {
    const allowed = Boolean(cloudConfig.entitlements.features?.analytics)
    const configured = Boolean(cloudConfig.siteConfig.portable.analytics?.enabled)
    if (!allowed || !configured) return NextResponse.json({ ok: true, skipped: true })
  }

  // Respect the admin's live analytics toggle (defaults to the docs.json setting, on).
  const enabled = (await getAdminSettings()).analyticsEnabled ?? isAnalyticsEnabled()
  if (!enabled) return NextResponse.json({ ok: true, skipped: true })

  try {
    const body = await request.json()
    if (
      cloudConfig &&
      cloudConfig.siteConfig.portable.analytics?.collectAgentTraffic === false &&
      body?.visitorType === 'agent'
    ) {
      return NextResponse.json({ ok: true, skipped: true })
    }
    await recordAnalyticsEvent(body)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
}
