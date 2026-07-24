/**
 * Dynamic social-image endpoint for documentation pages.
 */
import { type NextRequest } from 'next/server'
import { siteConfig } from '@/data/site'
import { renderDocsOgImage, type OgImageFont } from '@/lib/og-image'
import { resolveOgConfig } from '@/lib/og'
import { getBrandAsset } from '@/lib/admin/settings'

// Node is required because the admin storage adapter may use Node facilities.
export const runtime = 'nodejs'

async function loadFont(requestUrl: string, path: string, name: string, weight: 400 | 700): Promise<OgImageFont> {
  const response = await fetch(new URL(path, requestUrl))
  if (!response.ok) {
    throw new Error(`Unable to load OG font: ${path}`)
  }

  return {
    name,
    data: await response.arrayBuffer(),
    weight,
    style: 'normal',
  }
}

async function buildLeafDataUri(requestUrl: string, color: string) {
  const response = await fetch(new URL('/brand/thally-logo-light.svg', requestUrl))
  if (!response.ok) {
    throw new Error('Unable to load the bundled Thally mark')
  }

  const svg = (await response.text()).replace(/fill="[^"]+"/, `fill="${color}"`)
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const theme = searchParams.get('theme') === 'dark' ? 'dark' : 'light'
  const og = resolveOgConfig(theme, searchParams.get('accent') || undefined)
  const title = searchParams.get('title') || `${siteConfig.name} Documentation`
  const description = searchParams.get('description') || siteConfig.description
  const crumb = searchParams.get('crumb') || 'Documentation'
  const url = searchParams.get('url') || og.domain

  const requestedLogo =
    theme === 'dark'
      ? ((await getBrandAsset('logo-dark')) ?? (await getBrandAsset('logo')))
      : await getBrandAsset('logo')
  const logoUri = requestedLogo ?? (await buildLeafDataUri(request.url, og.leaf))

  const fonts = await Promise.all([
    loadFont(request.url, '/fonts/og/PlusJakartaSans-700.ttf', 'Jakarta', 700),
    loadFont(request.url, '/fonts/og/Inter-400.woff', 'Inter', 400),
    loadFont(request.url, '/fonts/og/JetBrainsMono-400.woff', 'Mono', 400),
  ])

  return renderDocsOgImage({
    title,
    description,
    crumb,
    url,
    brandName: og.logoText,
    logoUri,
    logoIsSquare: !requestedLogo,
    palette: og,
    fonts,
  })
}
