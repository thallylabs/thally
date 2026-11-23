/** Public identity and optional artwork availability, never private settings. */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getEffectiveSiteConfig } from '@/lib/admin/site-config'
import { getAdminSettings } from '@/lib/admin/settings'
import { resolveBrandAsset } from '@/lib/brand-assets'

export const runtime = 'nodejs'

/** Public: the effective site name/description/repo (build config + admin overrides).
 * Lets client components (the header) reflect dashboard edits without a rebuild. */
export async function GET(request: NextRequest) {
  const [identity, settings, lightLogo, darkLogo] = await Promise.all([
    getEffectiveSiteConfig(request.nextUrl.origin),
    getAdminSettings(),
    resolveBrandAsset('logo', 'light', request.nextUrl.origin),
    resolveBrandAsset('logo', 'dark', request.nextUrl.origin),
  ])
  // Project only public capabilities; never serialize the settings record.
  return NextResponse.json({
    ...identity,
    mcpEnabled: settings.mcpEnabled !== false,
    // Presence is enough to select the existing byte route. Upload data and
    // private configuration never cross this public identity projection.
    logos: {
      light: Boolean(lightLogo?.path || lightLogo?.dataUri),
      dark: Boolean(darkLogo?.path || darkLogo?.dataUri),
    },
  }, {
    headers: { 'cache-control': 'public, max-age=30' },
  })
}
