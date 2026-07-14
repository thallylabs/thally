import type { NextRequest } from 'next/server'
import { getBrandAsset } from '@/lib/admin/settings'
import { getCloudSiteConfig } from '@/lib/cloud-link/client'

export const runtime = 'nodejs'

/**
 * Serve the admin-uploaded logo (raster), or 404 so the header falls back to
 * the default mark. `?mode=dark` prefers the dark-mode upload and falls back
 * to the light/default logo when no dark variant exists.
 */
export async function GET(request: NextRequest) {
  const dark = request.nextUrl.searchParams.get('mode') === 'dark'
  const cloud = await getCloudSiteConfig(request.nextUrl.origin)
  const configured = dark
    ? cloud?.siteConfig.portable.branding?.logoDark ?? cloud?.siteConfig.portable.branding?.logo
    : cloud?.siteConfig.portable.branding?.logo
  const publicPath = normalizePublicAssetPath(configured)
  if (publicPath) return Response.redirect(new URL(publicPath, request.nextUrl.origin), 302)
  const uri = (dark ? await getBrandAsset('logo-dark') : null) ?? (await getBrandAsset('logo'))
  const match = uri ? /^data:(image\/[a-z]+);base64,(.+)$/.exec(uri) : null
  if (!match) return new Response(null, { status: 404 })
  return new Response(Buffer.from(match[2], 'base64'), {
    headers: { 'content-type': match[1], 'cache-control': 'public, max-age=300' },
  })
}

function normalizePublicAssetPath(value?: string): string | null {
  if (!value || value.includes('..') || /^https?:/i.test(value)) return null
  const normalized = value.replace(/^\/+/, '').replace(/^public\//, '')
  return normalized ? `/${normalized}` : null
}
