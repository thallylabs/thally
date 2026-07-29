/**
 * Content-aware locale resolution for crawler surfaces. Reader routes may
 * fall back to source content, but `hreflang` and sitemaps must only advertise
 * pages whose server-rendered body is actually authored in that language.
 */

import 'server-only'

import { hasDocTranslation } from '@/data/get-doc'
import type { I18nConfig } from './config'

/**
 * Keep the source locale plus every selected locale with a real translated
 * MDX entry for the requested slug.
 */
export async function getContentI18nConfig(
  slug: Array<string> | undefined,
  config: I18nConfig,
): Promise<I18nConfig> {
  const availability = await Promise.all(
    config.locales.map(async (locale) => {
      if (locale.code === config.defaultLocale) return true
      return hasDocTranslation(slug, locale.code)
    }),
  )

  return {
    defaultLocale: config.defaultLocale,
    locales: config.locales.filter((_, index) => availability[index]),
  }
}
