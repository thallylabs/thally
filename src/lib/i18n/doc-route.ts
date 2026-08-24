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
