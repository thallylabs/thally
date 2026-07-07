import { getBrandAsset } from '@/lib/admin/settings'

export const runtime = 'nodejs'

/** Serve the admin-uploaded favicon, or fall back to the generated /icon. */
export async function GET() {
  const uri = await getBrandAsset('favicon')
  const match = uri ? /^data:(image\/[a-z]+);base64,(.+)$/.exec(uri) : null
  if (!match) {
    return new Response(null, { status: 302, headers: { Location: '/icon' } })
  }
  return new Response(Buffer.from(match[2], 'base64'), {
    headers: { 'content-type': match[1], 'cache-control': 'public, max-age=300' },
  })
}
