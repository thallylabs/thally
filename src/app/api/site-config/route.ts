import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getEffectiveSiteConfig } from '@/lib/admin/site-config'

export const runtime = 'nodejs'

/** Public: the effective site name/description/repo (build config + admin overrides).
 * Lets client components (the header) reflect dashboard edits without a rebuild. */
export async function GET(request: NextRequest) {
  return NextResponse.json(await getEffectiveSiteConfig(request.nextUrl.origin), {
    headers: { 'cache-control': 'public, max-age=30' },
  })
}
