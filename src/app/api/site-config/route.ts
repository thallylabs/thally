import { NextResponse } from 'next/server'
import { getEffectiveSiteConfig } from '@/lib/admin/site-config'

export const runtime = 'nodejs'

/** Public: the effective site name/description/repo (build config + admin overrides).
 * Lets client components (the header) reflect dashboard edits without a rebuild. */
export async function GET() {
  return NextResponse.json(await getEffectiveSiteConfig(), {
    headers: { 'cache-control': 'public, max-age=30' },
  })
}
