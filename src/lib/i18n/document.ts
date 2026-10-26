/** Server-rendered document language follows authored content, including fallbacks. */

import 'server-only'

import { headers } from 'next/headers'
import { isAdminEnabledEdge } from '@/lib/admin/auth-edge'
import { getContentSource } from '@/lib/content-source'
import { findDocSource } from './translation-source'
import { resolveDocRoute } from './doc-route'
import { DOCUMENT_PATH_HEADER } from './document-path'
import type { I18nConfig } from './config'

/**
 * The root layout sits above the docs catch-all, so its params contain no
 * locale. Multi-locale sites therefore need request rendering to emit truthful
 * initial HTML. Live admin settings also need this boundary before they enable
 * a second locale, avoiding a later static-to-dynamic render. Single-locale
 * sites without live admin settings retain prerendering.
 */
export async function getDocumentLocale(config: I18nConfig): Promise<string> {
  if (config.locales.length < 2 && !isAdminEnabledEdge()) return config.defaultLocale

  const pathname = (await headers()).get(DOCUMENT_PATH_HEADER)
  if (config.locales.length < 2) return config.defaultLocale
  if (!pathname?.startsWith('/') || pathname.startsWith('//')) return config.defaultLocale
  let segments: string[]
  try {
    segments = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return config.defaultLocale
  }
  const route = resolveDocRoute(segments, config)
  if (!route.isLocaleRoute) return config.defaultLocale

  if (route.docSlug?.[0] === 'api') {
    // Generated OpenAPI prose stays in the source language even when its
    // navigation is localized. Authored API MDX uses the normal source lookup.
    const { getApiOperationBySlug } = await import('@/data/api-reference')
    if (await getApiOperationBySlug(route.docSlug.slice(1))) return config.defaultLocale
  }

  // Indexability is separate from language: an authored noindex translation
  // is still translated, while an English fallback must never claim otherwise.
  const source = await findDocSource(getContentSource(), (route.docSlug ?? []).join('/'), route.locale)
  return source && !source.isFallback ? route.locale : config.defaultLocale
}
