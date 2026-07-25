import { siteConfig } from '@/data/site'
import { getSiteUrl } from '@/lib/site-url'

/**
 * Build a URL string for the dynamic OG image endpoint.
 * All parameters are optional. The route handler fills in defaults from siteConfig.
 */
export function buildOgImageUrl(params: {
  title?: string
  description?: string
  crumb?: string
  url?: string
  theme?: 'light' | 'dark'
}): string {
  const searchParams = new URLSearchParams()
  if (params.title) searchParams.set('title', params.title)
  if (params.description) searchParams.set('description', params.description)
  if (params.crumb) searchParams.set('crumb', params.crumb)
  if (params.url) searchParams.set('url', params.url)
  if (params.theme) searchParams.set('theme', params.theme)

  const query = searchParams.toString()
  return `/api/og${query ? `?${query}` : ''}`
}

/**
 * Format a canonical path for the compact URL slot in a social preview.
 */
export function formatOgDisplayUrl(path = '/'): string {
  const url = new URL(path, getSiteUrl())
  return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
}

/**
 * Turn page navigation into the two-level breadcrumb used by the docs preview.
 */
export function formatOgBreadcrumb(
  breadcrumb: Array<{ label: string }>,
  title: string,
  fallback = 'Documentation',
): string {
  const labels = breadcrumb
    .map((item) => item.label.trim())
    .filter((label) => label && label.toLocaleLowerCase() !== title.trim().toLocaleLowerCase())

  return labels.slice(-2).join(' / ') || fallback
}

/**
 * Resolve the brand values used by the handoff-aligned docs preview.
 */
export function resolveOgConfig(theme: 'light' | 'dark', accentOverride?: string) {
  const og = siteConfig.ogImage ?? {}
  const palette =
    theme === 'dark'
      ? {
          background: '#131A14',
          foreground: '#F5F6EC',
          muted: '#ABB2A2',
          faint: '#7C8375',
          leaf: '#FFFFFF',
        }
      : {
          background: '#FBFBF3',
          foreground: '#252B22',
          muted: '#6C7268',
          faint: '#8B9188',
          leaf: '#41794F',
        }

  const accent = accentOverride && /^#[0-9a-fA-F]{3,8}$/.test(accentOverride) ? accentOverride : undefined
  const siteUrl = getSiteUrl()
  let domain = og.domain ?? ''
  if (!domain && siteUrl) {
    try {
      domain = new URL(siteUrl).hostname
    } catch {
      domain = siteUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    }
  }

  return {
    background: og.backgroundStart ?? palette.background,
    foreground: og.titleColor ?? palette.foreground,
    muted: og.descriptionColor ?? palette.muted,
    faint: og.groupColor ?? palette.faint,
    leaf: theme === 'light' ? (accent ?? og.accent ?? palette.leaf) : palette.leaf,
    domain: domain || siteConfig.name.toLowerCase(),
    logoText: og.logoText ?? siteConfig.name,
  }
}
