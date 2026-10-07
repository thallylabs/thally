/**
 * Canonical site-URL resolution for absolute links (llms.txt, sitemap.xml,
 * JSON-LD, OpenGraph, MCP manifests).
 *
 * Precedence: an explicit `THALLY_SITE_URL` (legacy `DOX_SITE_URL`, then
 * `NEXT_PUBLIC_SITE_URL`), then the URL the hosting provider publishes, then
 * the local development URL. A loopback explicit value never outranks a
 * provider URL: it almost always means a local `.env.local` was carried into a
 * hosted build, where `localhost` links are dead for every agent and crawler.
 */

const DEFAULT_SITE_URL = 'http://localhost:3040'

type Environment = Readonly<Record<string, string | undefined>>

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** Parse a provider value into an http(s) origin; schemeless values get https. */
function providerOrigin(value: string | undefined): string | undefined {
  const candidate = nonEmpty(value)
  if (!candidate) return undefined
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.origin
  } catch {
    return undefined
  }
}

/** The site URL an owner configured explicitly, if any. Empty values count as unset. */
function explicitSiteUrl(env: Environment): string | undefined {
  return nonEmpty(env.THALLY_SITE_URL) ?? nonEmpty(env.DOX_SITE_URL) ?? nonEmpty(env.NEXT_PUBLIC_SITE_URL)
}

/**
 * The public URL a recognized hosting provider exposes for this deployment.
 * Each provider's variables are read only behind that provider's own marker,
 * because names such as Netlify's `URL` are too generic to trust alone.
 * Production URLs win over per-deployment URLs so previews still emit
 * canonical links to the production site. Local development never uses them.
 *
 * - Vercel (`VERCEL=1`, build and runtime): `VERCEL_PROJECT_PRODUCTION_URL`,
 *   then `VERCEL_URL`. Both are schemeless.
 * - Netlify (`NETLIFY=true`, build time): `URL`, then `DEPLOY_PRIME_URL`.
 * - Cloudflare Pages (`CF_PAGES=1`, build time): `CF_PAGES_URL` (per deploy;
 *   Pages has no production-URL variable). Workers expose no URL variable.
 * - Render (`RENDER=true`, runtime): `RENDER_EXTERNAL_URL`.
 */
export function getHostingSiteUrl(env: Environment = process.env): string | undefined {
  if (env.NODE_ENV === 'development') return undefined
  if (env.VERCEL === '1' && env.VERCEL_ENV !== 'development') {
    return providerOrigin(env.VERCEL_PROJECT_PRODUCTION_URL) ?? providerOrigin(env.VERCEL_URL)
  }
  if (env.NETLIFY === 'true' && env.CONTEXT !== 'dev') {
    return providerOrigin(env.URL) ?? providerOrigin(env.DEPLOY_PRIME_URL)
  }
  if (env.CF_PAGES === '1') return providerOrigin(env.CF_PAGES_URL)
  if (env.RENDER === 'true') return providerOrigin(env.RENDER_EXTERNAL_URL)
  return undefined
}

/** True for localhost, `*.localhost`, and loopback or unspecified IP literals. */
export function isLoopbackUrl(value: string): boolean {
  let hostname: string
  try {
    hostname = new URL(value).hostname.toLowerCase()
  } catch {
    return false
  }
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || /^127(?:\.\d{1,3}){3}$/.test(hostname)
    || hostname === '0.0.0.0'
    || hostname === '[::1]'
    || hostname === '[::]'
}

/**
 * The canonical site URL. Users configure this with the framework-agnostic
 * `THALLY_SITE_URL` env var — they never need to know Next.js is underneath.
 * Without it, a recognized host's published URL is used, then the local dev
 * URL. See the module comment for the loopback rule.
 */
export function getSiteUrl(env: Environment = process.env): string {
  const explicit = explicitSiteUrl(env)
  const hosting = getHostingSiteUrl(env)
  if (explicit && !(hosting && isLoopbackUrl(explicit))) return explicit
  return hosting ?? DEFAULT_SITE_URL
}

let warnedMismatch = false

/**
 * Guard against a stale or missing site URL: when the resolved site-URL host
 * does not match the origin a request actually arrived on, every absolute link
 * in llms.txt / sitemap.xml / JSON-LD points at the resolved host — which may
 * be unreachable (the classic "all agent links are dead" misconfiguration).
 * Warns once per process and returns a message when they differ, else null, so
 * a route can also surface it (e.g. as a response header).
 */
export function siteUrlMismatch(requestOrigin: string): string | null {
  let configuredHost: string
  let requestHost: string
  try {
    configuredHost = new URL(getSiteUrl()).host
    requestHost = new URL(requestOrigin).host
  } catch {
    return null
  }
  if (!requestHost || configuredHost === requestHost) return null
  const isExplicit = Boolean(explicitSiteUrl(process.env))
  const hosting = getHostingSiteUrl()
  // Vercel previews deliberately point canonical links at production.
  if (!isExplicit && hosting && process.env.VERCEL_ENV === 'preview') return null
  const source = isExplicit
    ? 'Configured site URL'
    : hosting
      ? 'Hosting-provider site URL'
      : 'Default site URL (THALLY_SITE_URL is unset)'
  const message = `${source} host (${configuredHost}) does not match the request origin (${requestHost}); absolute links in llms.txt, sitemap.xml, and JSON-LD point at ${configuredHost}, which may be unreachable. Set THALLY_SITE_URL to your public origin (for example https://docs.example.com) in your host's environment settings and redeploy.`
  if (!warnedMismatch) {
    warnedMismatch = true
    console.warn(`[thally] ${message}`)
  }
  return message
}
