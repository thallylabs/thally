/**
 * Resolves optional locale prefixes inside the single documentation catch-all.
 *
 * Keeping this decision below one App Router segment is an invariant: separate
 * `[locale]/[[...slug]]` and `[[...slug]]` routes both match ordinary document
 * URLs, so Next can produce incompatible client and server router trees.
 */

import type { I18nConfig } from '@/lib/i18n/config'

export interface ResolvedDocRoute {
  docSlug: Array<string> | undefined
  locale: string
  isLocaleRoute: boolean
}

/**
 * Build a same-origin documentation path from decoded catch-all segments.
 * Encoding each segment prevents route input such as `//host` or backslashes
 * from becoming a scheme-relative navigation target when rendered in a link.
 */
export function docPathFromSlug(routeSlug: ReadonlyArray<string> | undefined): string {
  const pathname = (routeSlug ?? [])
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return pathname ? `/${pathname}` : '/'
}

/** Split a secondary-locale prefix from the underlying documentation slug. */
export function resolveDocRoute(
  routeSlug: Array<string> | undefined,
  config: I18nConfig,
): ResolvedDocRoute {
  const [candidateLocale, ...remainingSlug] = routeSlug ?? []
  const isLocaleRoute = config.locales.some(
    (locale) =>
      locale.code === candidateLocale && locale.code !== config.defaultLocale,
  )

  return {
    docSlug: isLocaleRoute
      ? remainingSlug.length > 0
        ? remainingSlug
        : undefined
      : routeSlug,
    locale: isLocaleRoute ? candidateLocale : config.defaultLocale,
    isLocaleRoute,
  }
}
