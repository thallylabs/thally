import type { Metadata } from 'next'
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { Providers } from '@/app/providers'
import { siteConfig } from '@/data/site'
import { getBannerConfig, getCustomScriptsConfig, getFontsConfig, getI18nConfig, getStructuralTheme } from '@/data/docs'
import { cn } from '@/lib/utils'
import { toHslValue, THEME_VARS } from '@thallylabs/core/theme'
import { buildOgImageUrl } from '@/lib/og'
import { buildSiteJsonLd } from '@/lib/json-ld'
import { getSiteUrl } from '@/lib/site-url'
import { JsonLdScript } from '@/components/seo/json-ld-script'
import { AnalyticsProvider } from '@/components/analytics/analytics-provider'
import { SiteBanner } from '@/components/layout/site-banner'
import { WebMcpTools } from '@/components/agent/web-mcp-tools'
import { CloudHandshake } from '@/components/cloud/cloud-handshake'

// Default fonts via next/font (optimal performance — preloaded, no FOUC).
// The Thally brand pairs Inter (body) with Plus Jakarta Sans (display —
// headings, wordmark); JetBrains Mono covers machine-facing text.
const fontSans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const fontDisplay = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

// ---------------------------------------------------------------------------
// Custom font injection from docs.json
// ---------------------------------------------------------------------------

function buildGoogleFontsUrl(family: string, weights: string[]): string {
  const familyParam = family.replace(/ /g, '+')
  // Google Fonts v2 format: family=Name:wght@400;600;700
  const weightParam = weights.join(';')
  return `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${weightParam}&display=swap`
}

const fontsConfig = getFontsConfig()

// Deduplicate Google Font URLs (body and heading might be the same family)
const googleFontUrlSet = new Set<string>()
let bodyFontFamily: string | null = null
let headingFontFamily: string | null = null

if (fontsConfig.body?.family) {
  bodyFontFamily = fontsConfig.body.family
  googleFontUrlSet.add(
    buildGoogleFontsUrl(fontsConfig.body.family, fontsConfig.body.weight ?? ['400', '500', '600', '700']),
  )
}

if (fontsConfig.heading?.family) {
  headingFontFamily = fontsConfig.heading.family
  googleFontUrlSet.add(
    buildGoogleFontsUrl(fontsConfig.heading.family, fontsConfig.heading.weight ?? ['600', '700']),
  )
}

const googleFontUrls = Array.from(googleFontUrlSet)

// CSS variable overrides injected into :root when custom fonts are set
const fontOverrides = [
  bodyFontFamily ? `--font-sans: '${bodyFontFamily}', sans-serif;` : '',
  headingFontFamily ? `--font-heading: '${headingFontFamily}', sans-serif;` : '',
]
  .filter(Boolean)
  .join(' ')

// ---------------------------------------------------------------------------
// Structural theme — read once at module level (same as fonts above)
const structuralTheme = getStructuralTheme()

// Structural theme CSS variable injection
// Injected as a <style> tag (same pattern as fontOverrides) so the overrides
// are SSR'd directly in the HTML. This is more reliable than html[data-theme]
// CSS attribute selectors, which depend on module-level caching behaviour and
// Next.js HMR propagation timing.
// ---------------------------------------------------------------------------
const themeVars = THEME_VARS[structuralTheme] ?? ''

// ---------------------------------------------------------------------------

const defaultOgImage = buildOgImageUrl({})

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: `${siteConfig.name} Documentation`,
    template: `%s • ${siteConfig.name}`,
  },
  description: siteConfig.description,
  // Derived from the site config so scaffolded sites never inherit
  // template-marketing keywords.
  keywords: [siteConfig.name, `${siteConfig.name} documentation`, 'docs'],
  icons: {
    // The dark link wins on OS dark scheme (link media can't follow the
    // in-site theme toggle); the route falls back to the light asset when no
    // dark variant is uploaded, so both links always resolve.
    icon: [
      { url: '/api/brand/favicon', media: '(prefers-color-scheme: light)' },
      { url: '/api/brand/favicon?mode=dark', media: '(prefers-color-scheme: dark)' },
    ],
    shortcut: '/api/brand/favicon',
  },
  openGraph: {
    title: `${siteConfig.name} Documentation`,
    description: siteConfig.description,
    url: getSiteUrl(),
    siteName: siteConfig.name,
    images: [{ url: defaultOgImage, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${siteConfig.name} Documentation`,
    description: siteConfig.description,
    images: [defaultOgImage],
  },
}

const brandStyle: Record<string, string> = {
  '--brand-light-background': toHslValue(siteConfig.brand.light.background),
  '--brand-light-foreground': toHslValue(siteConfig.brand.light.foreground),
  '--brand-light-muted': toHslValue(siteConfig.brand.light.muted),
  '--brand-light-border': toHslValue(siteConfig.brand.light.border),
  '--brand-light-accent': toHslValue(siteConfig.brand.light.accent),
  '--brand-light-accent-foreground': toHslValue(siteConfig.brand.light.accentForeground),
  '--brand-light-ring': toHslValue(siteConfig.brand.light.ring),
  '--brand-sidebar-active-bg-light': toHslValue(siteConfig.brand.light.sidebarActiveBg),
  '--brand-sidebar-active-text-light': toHslValue(siteConfig.brand.light.sidebarActiveText),
  '--brand-dark-background': toHslValue(siteConfig.brand.dark.background),
  '--brand-dark-foreground': toHslValue(siteConfig.brand.dark.foreground),
  '--brand-dark-muted': toHslValue(siteConfig.brand.dark.muted),
  '--brand-dark-border': toHslValue(siteConfig.brand.dark.border),
  '--brand-dark-accent': toHslValue(siteConfig.brand.dark.accent),
  '--brand-dark-accent-foreground': toHslValue(siteConfig.brand.dark.accentForeground),
  '--brand-dark-ring': toHslValue(siteConfig.brand.dark.ring),
  '--brand-sidebar-active-bg-dark': toHslValue(siteConfig.brand.dark.sidebarActiveBg),
  '--brand-sidebar-active-text-dark': toHslValue(siteConfig.brand.dark.sidebarActiveText),
}

// The brand palette must live in a :root <style> (NOT inline on <html>): inline
// styles beat every stylesheet, so /api/brand.css could never override the
// dashboard accent. As a :root rule, brand.css's :root:root wins.
const brandCss = Object.entries(brandStyle)
  .map(([k, v]) => `${k}:${v}`)
  .join(';')

const defaultLang = getI18nConfig()?.defaultLocale ?? 'en'
const bannerConfig = getBannerConfig()
const customScripts = getCustomScriptsConfig()
const siteUrl = getSiteUrl()
const siteJsonLd = buildSiteJsonLd({ siteUrl, locale: defaultLang })

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // Font variables live on <html> (not <body>) so :root-level rules — the
    // globals.css --font-heading default and docs.json font overrides — can
    // reference and override them.
    <html
      lang={defaultLang}
      suppressHydrationWarning
      data-theme={structuralTheme}
      className={cn(fontSans.variable, fontDisplay.variable, fontMono.variable)}
    >
      <head>
        <JsonLdScript data={siteJsonLd} />
        {/* Google Fonts for custom body/heading fonts set in docs.json */}
        {googleFontUrls.length > 0 && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            {googleFontUrls.map((url) => (
              <link key={url} rel="stylesheet" href={url} />
            ))}
          </>
        )}
        {/* Brand palette (default) — a :root rule so /api/brand.css can override it */}
        <style>{`:root { ${brandCss} }`}</style>
        {/* CSS variable overrides for custom fonts */}
        {fontOverrides && <style>{`:root { ${fontOverrides} }`}</style>}
        {/* CSS variable overrides for structural theme (radius, sidebar, nav tabs) */}
        {themeVars && <style>{`:root { ${themeVars} }`}</style>}
        {/* Live admin branding override (theme + accent from the dashboard) — last so it wins */}
        {/* eslint-disable-next-line @next/next/no-head-element */}
        <link rel="stylesheet" href="/api/brand.css" />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {bannerConfig && <SiteBanner banner={bannerConfig} />}
        <Providers>{children}</Providers>
        <CloudHandshake />
        <AnalyticsProvider />
        <WebMcpTools />
        {customScripts.map((script) => (
          <Script
            key={script.src}
            src={script.src}
            strategy={script.strategy ?? 'afterInteractive'}
          />
        ))}
      </body>
    </html>
  )
}
