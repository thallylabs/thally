/** Middleware-owned path context for server-rendered managed document language. */

import type { I18nConfig } from './config'

export const DOCUMENT_PATH_HEADER = 'x-thally-document-path'

/** Resolve only enabled, exact route prefixes; arbitrary headers cannot invent a locale. */
export function documentLocaleFromPath(pathname: string | null, i18n: I18nConfig): string {
  const prefix = pathname?.startsWith('/') ? pathname.split('/')[1] : null
  return i18n.locales.find(locale => locale.code === prefix)?.code ?? i18n.defaultLocale
}
