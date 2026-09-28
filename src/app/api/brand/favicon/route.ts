import type { NextRequest } from 'next/server'
import { getBrandAsset } from '@/lib/admin/settings'
import { getCloudSiteConfig } from '@/lib/cloud-link/client'
import { getDocsJsonConfig } from '@/lib/docs-json-config'
import { publicBrandAssetPath } from '@/lib/public-brand-asset'

export const runtime = 'nodejs'

/**
 * Serve the admin-uploaded favicon, or fall back to the bundled default brand
 * icon (public/brand, per mode — ships with every scaffold). `?mode=dark`
 * prefers the dark-mode upload and falls back to the light upload first.
 */
export async function GET(request: NextRequest) {
  const dark = request.nextUrl.searchParams.get('mode') === 'dark'
  // The favicon has no client-side fallback (a failed response means the tab
  // shows no icon at all), so any error while resolving custom branding must
  // degrade to the bundled default mark — never a 5xx.
  let match: RegExpExecArray | null = null
  try {
    const cloud = await getCloudSiteConfig(request.nextUrl.origin)
    const configured = dark
      ? cloud?.siteConfig.portable.branding?.faviconDark ?? cloud?.siteConfig.portable.branding?.favicon
      : cloud?.siteConfig.portable.branding?.favicon
    const publicPath = publicBrandAssetPath(configured)
    if (publicPath) return Response.redirect(new URL(publicPath, request.nextUrl.origin), 302)
    const uri = (dark ? await getBrandAsset('favicon-dark') : null) ?? (await getBrandAsset('favicon'))
    match = uri ? /^data:(image\/[a-z]+);base64,(.+)$/.exec(uri) : null
  } catch {
    match = null
  }
  if (!match) {
    const docs = getDocsJsonConfig<{ favicon?: { light: string; dark?: string } }>()
    const favicon = docs.favicon
    const source = dark ? favicon?.dark ?? favicon?.light : favicon?.light
    const path = publicBrandAssetPath(source)
    if (path) return Response.redirect(new URL(path, request.nextUrl.origin), 302)
    return new Response(null, {
      status: 302,
      headers: { Location: `/brand/default-favicon-${dark ? 'dark' : 'light'}.svg` },
    })
  }
  return new Response(Buffer.from(match[2], 'base64'), {
    headers: { 'content-type': match[1], 'cache-control': 'public, max-age=300' },
  })
}
