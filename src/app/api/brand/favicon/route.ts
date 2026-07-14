import type { NextRequest } from 'next/server'
import { getBrandAsset } from '@/lib/admin/settings'
import { getCloudSiteConfig } from '@/lib/cloud-link/client'

export const runtime = 'nodejs'

/**
 * Serve the admin-uploaded favicon, or fall back to the bundled default brand
 * icon (public/brand, per mode — ships with every scaffold). `?mode=dark`
 * prefers the dark-mode upload and falls back to the light upload first.
 */
export async function GET(request: NextRequest) {
  const dark = request.nextUrl.searchParams.get('mode') === 'dark'
  const cloud = await getCloudSiteConfig(request.nextUrl.origin)
  const configured = dark
    ? cloud?.siteConfig.portable.branding?.faviconDark ?? cloud?.siteConfig.portable.branding?.favicon
    : cloud?.siteConfig.portable.branding?.favicon
  const publicPath = normalizePublicAssetPath(configured)
  if (publicPath) return Response.redirect(new URL(publicPath, request.nextUrl.origin), 302)
  const uri = (dark ? await getBrandAsset('favicon-dark') : null) ?? (await getBrandAsset('favicon'))
  const match = uri ? /^data:(image\/[a-z]+);base64,(.+)$/.exec(uri) : null
  if (!match) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/brand/thally-favicon-${dark ? 'dark' : 'light'}.png` },
    })
  }
  return new Response(Buffer.from(match[2], 'base64'), {
    headers: { 'content-type': match[1], 'cache-control': 'public, max-age=300' },
  })
}

function normalizePublicAssetPath(value?: string): string | null {
  if (!value || value.includes('..') || /^https?:/i.test(value)) return null
  const normalized = value.replace(/^\/+/, '').replace(/^public\//, '')
  return normalized ? `/${normalized}` : null
}
