import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getEffectiveSiteConfig } from '@/lib/admin/site-config'
import { resolveBrandAsset } from '@/lib/brand-assets'

export const runtime = 'nodejs'

/** Public: the effective site name/description/repo (build config + admin overrides).
 * Lets client components (the header) reflect dashboard edits without a rebuild. */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin
  const [config, light, dark] = await Promise.all([
    getEffectiveSiteConfig(origin),
    resolveBrandAsset('logo', 'light', origin),
    resolveBrandAsset('logo', 'dark', origin),
  ])
  // Availability is enough for clients to opt into the image route. Never
  // serialize upload bytes or the server-only configuration into this response.
  return NextResponse.json({
    ...config,
    logoAvailability: {
      light: Boolean(light?.path || light?.dataUri),
      dark: Boolean(dark?.path || dark?.dataUri),
    },
  }, {
    headers: { 'cache-control': 'public, max-age=30' },
  })
}
