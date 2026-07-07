const DEFAULT_SITE_URL = 'http://localhost:3040'

/**
 * The canonical site URL. Users configure this with the framework-agnostic
 * `DOX_SITE_URL` env var — they never need to know Next.js is underneath.
 *
 * Falls back to the legacy `NEXT_PUBLIC_SITE_URL` for backward compatibility,
 * then to the local dev URL.
 */
export function getSiteUrl(): string {
  return process.env.DOX_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL
}
