import { getAdminSettings } from '@/lib/admin/settings'
import { themeVarsFor, toHslValue } from '@thallylabs/core/theme'
import type { NextRequest } from 'next/server'
import { getCloudSiteConfig } from '@/lib/cloud-link/client'
import { brandRuntimeCss } from '@/lib/brand-runtime-css'

export const runtime = 'nodejs'

const HEX = /^#[0-9a-fA-F]{3,8}$/

/**
 * Live admin branding override — the docs layout links this after its SSR'd
 * defaults, so a theme/accent chosen in the dashboard applies site-wide without
 * making every page dynamic. Empty when nothing is overridden.
 */
export async function GET(request: NextRequest) {
  const [s, cloud] = await Promise.all([
    getAdminSettings(),
    getCloudSiteConfig(request.nextUrl.origin),
  ])
  const parts: Array<string> = []

  const theme = cloud?.siteConfig.portable.branding?.themePreset ?? s.brandTheme
  if (theme) parts.push(themeVarsFor(theme))

  const cloudBranding = cloud?.siteConfig.portable.branding
  if (!cloudBranding?.colors && s.brandAccent) {
    const { light, dark } = s.brandAccent
    if (typeof light === 'string' && HEX.test(light)) {
      const hsl = toHslValue(light)
      parts.push(`--brand-light-accent:${hsl}`, `--brand-light-ring:${hsl}`)
    }
    if (typeof dark === 'string' && HEX.test(dark)) {
      const hsl = toHslValue(dark)
      parts.push(`--brand-dark-accent:${hsl}`, `--brand-dark-ring:${hsl}`)
    }
  }

  // `:root:root` (specificity 0,2,0) beats globals.css's `:root` (0,1,0) so the
  // override wins regardless of how Next/React 19 orders the stylesheets by
  // precedence — otherwise the globals bundle can re-sort after this link.
  const declarations = parts.filter(Boolean).join(';')
  const legacyCss = declarations ? `:root:root{${declarations}}` : ''
  const css = [brandRuntimeCss(cloudBranding), legacyCss].filter(Boolean).join('\n')
  return new Response(css, {
    headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=30' },
  })
}
