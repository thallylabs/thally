/** Content-aware reader links retain the requested locale only for authored translations. */

import 'server-only'

import type { NavContext } from '@/data/docs'
import { hasDocTranslation } from '@/lib/i18n/translation-source'
import { localizedPath } from './config'

/** Localize breadcrumb and adjacent-page destinations without changing navigation order or source fallbacks. */
export async function localizeDocNavigation(
  navigation: NavContext,
  locale: string,
  defaultLocale: string,
): Promise<NavContext> {
  if (locale === defaultLocale) return navigation
  const destinations = new Map<string, Promise<string>>()
  function hrefFor(href: string): Promise<string> {
    const cached = destinations.get(href)
    if (cached) return cached
    const pending = (async () => {
      // Collection links can be external. Availability checks only apply to
      // canonical local document routes, never remote destinations.
      if (!href.startsWith('/') || href.startsWith('//')) return href
      const suffixAt = href.search(/[?#]/)
      const path = suffixAt < 0 ? href : href.slice(0, suffixAt)
      const suffix = suffixAt < 0 ? '' : href.slice(suffixAt)
      // A locale-specific navigation tree already carries prefixed routes.
      // Check their canonical page IDs so missing translations still fall
      // back to the primary page instead of pointing at an absent URL.
      const isLocalized = path === `/${locale}` || path.startsWith(`/${locale}/`)
      const canonical = isLocalized ? path.slice(locale.length + 1) || '/' : path
      const exists = await hasDocTranslation(canonical.split('/').filter(Boolean), locale)
      return exists ? `${localizedPath(canonical, locale, defaultLocale)}${suffix}` : `${canonical}${suffix}`
    })()
    destinations.set(href, pending)
    return pending
  }
  const [prev, next, breadcrumb] = await Promise.all([
    navigation.prev ? hrefFor(navigation.prev.href).then((href) => ({ ...navigation.prev!, href })) : null,
    navigation.next ? hrefFor(navigation.next.href).then((href) => ({ ...navigation.next!, href })) : null,
    Promise.all(navigation.breadcrumb.map(async (item) => item.href
      ? { ...item, href: await hrefFor(item.href) }
      : item)),
  ])
  return { ...navigation, prev, next, breadcrumb }
}
