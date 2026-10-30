import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getEffectiveSiteConfig } from '@/lib/admin/site-config'
import { getAdminSettings } from '@/lib/admin/settings'

export const runtime = 'nodejs'

/** Public: the effective site name/description/repo (build config + admin overrides).
 * Lets client components (the header) reflect dashboard edits without a rebuild. */
export async function GET(request: NextRequest) {
  const [identity, settings] = await Promise.all([
    getEffectiveSiteConfig(request.nextUrl.origin),
    getAdminSettings(),
  ])
  // Only this public capability flag crosses the boundary; never serialize settings.
  return NextResponse.json({ ...identity, mcpEnabled: settings.mcpEnabled !== false }, {
    headers: { 'cache-control': 'public, max-age=30' },
  })
}
