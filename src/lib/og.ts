import { siteConfig } from '@/data/site'

/**
 * Build a URL string for the dynamic OG image endpoint.
 * All parameters are optional — the route handler fills in defaults from siteConfig.
 */
export function buildOgImageUrl(params: {
  title?: string
  description?: string
  group?: string
}): string {
  const searchParams = new URLSearchParams()
  if (params.title) searchParams.set('title', params.title)
  if (params.description) searchParams.set('description', params.description)
  if (params.group) searchParams.set('group', params.group)

  const query = searchParams.toString()
  return `/api/og${query ? `?${query}` : ''}`
}

/**
 * Resolve the full set of OG image colors by merging user overrides with brand defaults.
 * Used by the /api/og route handler.
 */
export function resolveOgConfig(accentOverride?: string) {
  const og = siteConfig.ogImage ?? {}
  const dark = siteConfig.brand.dark

  // accentOverride powers the branding-page preview (a chosen-but-not-yet-applied
  // accent); otherwise the OG derives entirely from the site brand.
  const accent = (accentOverride && /^#[0-9a-fA-F]{3,8}$/.test(accentOverride) ? accentOverride : undefined) ?? og.accent ?? dark.accent
  const siteUrl = process.env.DOX_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? ''
  let domain = og.domain ?? ''
  if (!domain && siteUrl) {
    try {
      domain = new URL(siteUrl).hostname
    } catch {
      domain = siteUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    }
  }

  return {
    backgroundStart: og.backgroundStart ?? dark.background,
    backgroundEnd: og.backgroundEnd ?? dark.muted,
    accent,
    titleColor: og.titleColor ?? dark.foreground,
    descriptionColor: og.descriptionColor ?? `${dark.foreground}99`,
    groupColor: og.groupColor ?? accent,
    domain: domain || siteConfig.name.toLowerCase(),
    logoText: og.logoText ?? siteConfig.name,
    fontFamily: og.fontFamily ?? 'Inter',
    fontWeight: og.fontWeight ?? '700',
  }
}
