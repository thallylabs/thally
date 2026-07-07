import { getBrandAsset } from '@/lib/admin/settings'

export const runtime = 'nodejs'

/** Serve the admin-uploaded logo (raster), or 404 so the header falls back to the default mark. */
export async function GET() {
  const uri = await getBrandAsset('logo')
  const match = uri ? /^data:(image\/[a-z]+);base64,(.+)$/.exec(uri) : null
  if (!match) return new Response(null, { status: 404 })
  return new Response(Buffer.from(match[2], 'base64'), {
    headers: { 'content-type': match[1], 'cache-control': 'public, max-age=300' },
  })
}
