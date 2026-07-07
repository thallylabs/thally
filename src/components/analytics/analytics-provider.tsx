'use client'

import Script from 'next/script'
import { siteConfig } from '@/data/site'

/**
 * Renders analytics scripts based on the `analytics` config in `src/data/site.ts`.
 * Supports Google Analytics, Plausible, and PostHog out of the box.
 * Drop this component into the root layout — it renders nothing if no provider is configured.
 */
export function AnalyticsProvider() {
  const config = siteConfig.analytics

  if (!config) return null

  return (
    <>
      {/* Google Analytics */}
      {config.googleAnalyticsId ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${config.googleAnalyticsId}`}
            strategy="afterInteractive"
          />
          <Script id="ga-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${config.googleAnalyticsId}');
            `}
          </Script>
        </>
      ) : null}

      {/* Plausible */}
      {config.plausibleDomain ? (
        <Script
          defer
          data-domain={config.plausibleDomain}
          src={config.plausibleScriptUrl ?? 'https://plausible.io/js/script.js'}
          strategy="afterInteractive"
        />
      ) : null}

      {/* PostHog */}
      {config.posthogKey ? (
        <Script id="posthog-init" strategy="afterInteractive">
          {`
            !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
            posthog.init('${config.posthogKey}', {
              api_host: '${config.posthogHost ?? 'https://us.i.posthog.com'}',
              person_profiles: 'identified_only',
            });
          `}
        </Script>
      ) : null}
    </>
  )
}
