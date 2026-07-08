import type { NextRequest } from 'next/server'
import { getBrandAsset } from '@/lib/admin/settings'

export const runtime = 'nodejs'

/**
 * Serve the admin-uploaded logo (raster), or 404 so the header falls back to
 * the default mark. `?mode=dark` prefers the dark-mode upload and falls back
 * to the light/default logo when no dark variant exists.
 */
export async function GET(request: NextRequest) {
  const dark = request.nextUrl.searchParams.get('mode') === 'dark'
  const uri = (dark ? await getBrandAsset('logo-dark') : null) ?? (await getBrandAsset('logo'))
  const match = uri ? /^data:(image\/[a-z]+);base64,(.+)$/.exec(uri) : null
  if (!match) return new Response(null, { status: 404 })
  return new Response(Buffer.from(match[2], 'base64'), {
    headers: { 'content-type': match[1], 'cache-control': 'public, max-age=300' },
  })
}
