/**
 * Crawler-facing locale links derived from the same normalized configuration
 * used by routing and the reader-facing language switcher.
 */

import { localizedPath, type I18nConfig } from './config'

/**
 * Build `hreflang` targets for one logical page. `x-default` always points to
 * the repository source route so crawlers have an unambiguous fallback.
 */
export function buildLocaleAlternates(
  siteUrl: string,
  path: string,
  config: I18nConfig,
): Record<string, string> {
  return {
    ...Object.fromEntries(
      config.locales.map((locale) => [
        locale.code,
        `${siteUrl}${localizedPath(path, locale.code, config.defaultLocale)}`,
      ]),
    ),
    'x-default': `${siteUrl}${localizedPath(path, config.defaultLocale, config.defaultLocale)}`,
  }
}
