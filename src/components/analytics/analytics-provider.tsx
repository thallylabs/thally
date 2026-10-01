'use client'

import Script from 'next/script'
import { buildAnalyticsScripts, gtmNoScriptUrl, type ResolvedAnalytics } from '@/lib/analytics-config'

/**
 * Renders analytics scripts from an already validated config. The root layout
 * resolves `siteConfig.analytics` (src/data/site.ts) and `integrations`
 * (docs.json) with `resolveAnalyticsConfig`; this component renders nothing
 * when no provider survived validation.
 */
export function AnalyticsProvider({ config }: { config: ResolvedAnalytics }) {
  const scripts = buildAnalyticsScripts(config)
  if (scripts.length === 0) return null

  return (
    <>
      {scripts.map((script) =>
        script.src ? (
          <Script
            key={script.key}
            src={script.src}
            strategy="afterInteractive"
            {...(script.attrs ?? {})}
            {...(script.key === 'plausible-loader' ? { defer: true } : {})}
          />
        ) : (
          <Script key={script.key} id={script.id} strategy="afterInteractive">
            {script.inline}
          </Script>
        ),
      )}
    </>
  )
}

/** Google Tag Manager's documented <noscript> fallback; render at the start of <body>. */
export function GtmNoScript({ config }: { config: ResolvedAnalytics }) {
  const src = gtmNoScriptUrl(config)
  if (!src) return null
  return (
    <noscript>
      <iframe src={src} height="0" width="0" style={{ display: 'none', visibility: 'hidden' }} title="Google Tag Manager" />
    </noscript>
  )
}
