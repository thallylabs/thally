/**
 * Third-party analytics configuration: validation, merging, and script plans.
 *
 * Sources, highest precedence first, resolved per provider:
 *   1. `siteConfig.analytics` in `src/data/site.ts` (explicit code config)
 *   2. `integrations` in `docs.json` (Mintlify-shaped: ga4, gtm, posthog, plausible)
 *
 * docs.json can be edited outside code review (managed bindings, migrated
 * repositories), so its values are placed inside a script or script URL only
 * when they match a strict allow-list; anything else skips that provider with a
 * warning and never throws. `siteConfig.analytics` is trusted code and renders
 * as written, serialised safely.
 *
 * The migrator (`packages/migrate/src/analytics.ts`) carries the same patterns.
 * `src/lib/__tests__/analytics-config.test.ts` asserts the two agree.
 */

export interface AnalyticsSiteConfig {
  googleAnalyticsId?: string
  plausibleDomain?: string
  plausibleScriptUrl?: string
  posthogKey?: string
  posthogHost?: string
}

export interface ResolvedAnalytics {
  ga4?: { measurementId: string }
  gtm?: { tagId: string }
  plausible?: { domain: string; scriptUrl: string }
  posthog?: { apiKey: string; apiHost: string; sessionRecording: boolean }
}

export const GA4_ID = /^G-[A-Z0-9]{4,20}$/
export const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/
export const POSTHOG_KEY = /^phc_[A-Za-z0-9]{20,64}$/
const HOSTNAME_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const HOSTNAME = new RegExp(`^${HOSTNAME_LABEL}(?:\\.${HOSTNAME_LABEL})*$`)
const SAFE_PATH = /^\/[A-Za-z0-9._~\-/]*$/

export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'
export const DEFAULT_PLAUSIBLE_SCRIPT = 'https://plausible.io/js/script.js'
const MAX_PLAUSIBLE_DOMAINS = 10

/** Trim strings; everything else (numbers, arrays, objects, null) is not a usable value. */
export function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 2_048 ? trimmed : undefined
}

/** `https://host[:port][/safe/path]` only: no credentials, query, fragment, or dot segments. */
export function normalizeHttpsUrl(value: string, opts: { path: 'none' | 'any' }): string | null {
  if (!/^https:\/\//i.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
  if (value.includes('?') || value.includes('#') || value.includes('\\')) return null
  if (!HOSTNAME.test(url.hostname)) return null
  // Judge the path as written: URL parsing would silently resolve `..` segments.
  const rawPath = (/^https:\/\/[^/]*(\/.*)?$/i.exec(value)?.[1] ?? '').replace(/\/+$/, '')
  if (rawPath && (!SAFE_PATH.test(rawPath) || rawPath.split('/').some((segment) => segment === '..' || segment === '.'))) return null
  if (rawPath && opts.path === 'none') return null
  const path = rawPath
  return `${url.origin}${path}`
}

/** One hostname or a comma-separated list (Plausible's multi-domain form); lowercased. */
export function normalizePlausibleDomains(value: string): string | null {
  const parts = value.split(',').map((part) => part.trim().toLowerCase())
  if (parts.length > MAX_PLAUSIBLE_DOMAINS) return null
  return parts.every((part) => part.length <= 253 && HOSTNAME.test(part)) ? parts.join(',') : null
}

/**
 * Mintlify's `plausible.server` is a bare hostname of a self-hosted instance.
 * A pasted `https://host` origin is accepted too; the script path is fixed.
 */
export function plausibleScriptFromServer(value: string): string | null {
  const host = /^https:\/\//i.test(value) ? normalizeHttpsUrl(value, { path: 'none' }) : null
  if (host) return `${host}/js/script.js`
  const bare = /^([a-z0-9.-]+)(:\d{1,5})?$/i.exec(value)
  if (!bare || !HOSTNAME.test(bare[1].toLowerCase())) return null
  return `https://${bare[1].toLowerCase()}${bare[2] ?? ''}/js/script.js`
}

const warned = new Set<string>()
function warn(message: string): void {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(`[analytics] ${message}`)
}

/** Test hook: warnings are deduplicated per isolate. */
export function resetAnalyticsWarningsForTests(): void {
  warned.clear()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function own(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
}

/**
 * Merge and validate both sources. `siteConfig.analytics` wins per provider
 * whenever it sets that provider's primary key, even when its value is invalid
 * (the provider is then skipped rather than silently swapped for another source).
 */
export function resolveAnalyticsConfig(site: unknown, integrations: unknown): ResolvedAnalytics {
  const out: ResolvedAnalytics = {}
  const s = isRecord(site) ? site : {}
  const i = isRecord(integrations) ? integrations : {}
  const block = (name: string): Record<string, unknown> | null => {
    const value = own(i, name)
    if (value === undefined) return null
    if (!isRecord(value)) {
      warn(`docs.json integrations.${name} must be an object; provider skipped.`)
      return null
    }
    return value
  }
  const set = (value: unknown) => value !== undefined && value !== null && value !== ''

  // `siteConfig.analytics` is author-written code: its values render exactly as
  // they always have (no validation), only serialised safely. Everything below
  // that reads `integrations` (docs.json, the untrusted boundary) is validated.
  const siteString = (key: string): string | undefined => {
    const value = own(s, key)
    return typeof value === 'string' && value ? value : undefined
  }

  // Google Analytics 4
  const ga4Site = siteString('googleAnalyticsId')
  if (ga4Site) out.ga4 = { measurementId: ga4Site }
  else {
    const ga4Block = block('ga4')
    const raw = ga4Block ? own(ga4Block, 'measurementId') : undefined
    if (set(raw)) {
      const id = cleanString(raw)
      if (id && GA4_ID.test(id)) out.ga4 = { measurementId: id }
      else warn('integrations.ga4.measurementId is not a valid GA4 measurement ID (expected G-XXXXXXXXXX; Universal Analytics UA- IDs are unsupported); provider skipped.')
    }
  }

  // Google Tag Manager (docs.json only)
  const gtmBlock = block('gtm')
  if (gtmBlock && set(own(gtmBlock, 'tagId'))) {
    const id = cleanString(own(gtmBlock, 'tagId'))
    if (id && GTM_ID.test(id)) out.gtm = { tagId: id }
    else warn('integrations.gtm.tagId is not a valid GTM container ID (expected GTM-XXXXXXX); provider skipped.')
  }

  // Plausible
  const plausibleSite = siteString('plausibleDomain')
  if (plausibleSite) {
    const custom = own(s, 'plausibleScriptUrl')
    out.plausible = { domain: plausibleSite, scriptUrl: typeof custom === 'string' ? custom : DEFAULT_PLAUSIBLE_SCRIPT }
  } else {
    const plausibleBlock = block('plausible')
    const raw = plausibleBlock ? own(plausibleBlock, 'domain') : undefined
    if (plausibleBlock && set(raw)) {
      const domain = cleanString(raw)
      const normalized = domain ? normalizePlausibleDomains(domain) : null
      let scriptUrl: string | null = DEFAULT_PLAUSIBLE_SCRIPT
      if (set(own(plausibleBlock, 'server'))) {
        const server = cleanString(own(plausibleBlock, 'server'))
        scriptUrl = server ? plausibleScriptFromServer(server) : null
      }
      if (normalized && scriptUrl) out.plausible = { domain: normalized, scriptUrl }
      else warn('integrations.plausible needs hostname(s) as domain and a hostname as server; provider skipped.')
    }
  }

  // PostHog
  const posthogSite = siteString('posthogKey')
  if (posthogSite) {
    const host = own(s, 'posthogHost')
    out.posthog = { apiKey: posthogSite, apiHost: typeof host === 'string' ? host : DEFAULT_POSTHOG_HOST, sessionRecording: true }
  } else {
    const posthogBlock = block('posthog')
    const raw = posthogBlock ? own(posthogBlock, 'apiKey') : undefined
    if (posthogBlock && set(raw)) {
      const key = cleanString(raw)
      const hostRaw = own(posthogBlock, 'apiHost')
      const hostClean = set(hostRaw) ? cleanString(hostRaw) : DEFAULT_POSTHOG_HOST
      const host = hostClean ? normalizeHttpsUrl(hostClean, { path: 'any' }) : null
      if (key && POSTHOG_KEY.test(key) && host) {
        out.posthog = { apiKey: key, apiHost: host, sessionRecording: own(posthogBlock, 'sessionRecording') !== false }
      } else warn('integrations.posthog needs a phc_ apiKey and an https apiHost without credentials, query, or fragment; provider skipped.')
    }
  }

  return out
}

/** Escape a value for embedding in an inline script: JSON, with `<` neutralised. */
function js(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`)
}

const POSTHOG_LOADER =
  '!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);'

export interface AnalyticsScript {
  /** Stable React key. */
  key: string
  /** DOM id; omitted on src-only loaders, which next/script dedupes by src. */
  id?: string
  src?: string
  inline?: string
  attrs?: Record<string, string>
}

/** One entry per loader: the renderer maps these onto `next/script` tags. */
export function buildAnalyticsScripts(config: ResolvedAnalytics): Array<AnalyticsScript> {
  const scripts: Array<AnalyticsScript> = []
  if (config.ga4) {
    const id = config.ga4.measurementId
    scripts.push({ key: 'ga-loader', src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}` })
    scripts.push({
      key: 'ga-init',
      id: 'ga-init',
      inline: `window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', ${js(id)});`,
    })
  }
  if (config.gtm) {
    const id = config.gtm.tagId
    scripts.push({
      key: 'gtm-init',
      id: 'gtm-init',
      inline: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+encodeURIComponent(i);f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${js(id)});`,
    })
  }
  if (config.plausible) {
    scripts.push({
      key: 'plausible-loader',
      src: config.plausible.scriptUrl,
      attrs: { 'data-domain': config.plausible.domain },
    })
  }
  if (config.posthog) {
    const options: Record<string, unknown> = { api_host: config.posthog.apiHost, person_profiles: 'identified_only' }
    if (!config.posthog.sessionRecording) options.disable_session_recording = true
    scripts.push({
      key: 'posthog-init',
      id: 'posthog-init',
      inline: `${POSTHOG_LOADER}posthog.init(${js(config.posthog.apiKey)}, ${js(options)});`,
    })
  }
  return scripts
}

export function gtmNoScriptUrl(config: ResolvedAnalytics): string | null {
  return config.gtm ? `https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(config.gtm.tagId)}` : null
}
