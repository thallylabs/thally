/**
 * App → engine binding for page enumeration.
 *
 * `@thallylabs/core` is framework-agnostic and does not know how this site
 * lists its pages, so it exposes a resolver seam. This module fills it with the
 * app's `docs.json` + `src/content`-derived page list and runtime-aware content
 * reader. It is imported for its side-effect by every engine entry point
 * (search + embeddings), so registration always runs before the first corpus
 * or embedding-index build.
 *
 * Idempotent (last-wins), so multiple entry points importing it is harmless.
 * `DocEntry` is a structural superset of core's `DocEntrySummary`, so the app's
 * richer entries satisfy the resolver contract directly.
 */
import {
  registerAsyncContentDocumentSource,
  registerAsyncDocEntriesSource,
  registerContentDocumentSource,
  registerDocEntriesSource,
} from '@thallylabs/core/registry'
import { getDocEntries, getCurrentVersionPageIds, loadDocEntries } from '@/data/docs'
import { getContentDocument, loadContentDocument } from '@/lib/content/document'
import { getIndexableDocTranslation } from '@/lib/i18n/translation-source'
import { localizedPath } from '@/lib/i18n/config'
import { getEffectiveI18nConfig } from '@/lib/i18n/request'

/** On a versioned site, older versions (v1, v0) stay reachable by URL but never outrank the current docs in search. */
const isSearchable = (entry: { id: string; noindex?: boolean; hidden?: boolean }, currentVersionIds: Set<string> | null) =>
  !entry.noindex && !entry.hidden && (!currentVersionIds || currentVersionIds.has(entry.id))

registerDocEntriesSource(() => {
  const currentVersionIds = getCurrentVersionPageIds()
  return getDocEntries().filter((entry) => isSearchable(entry, currentVersionIds))
})
registerContentDocumentSource((pageId, locale) => getContentDocument(pageId, locale))
registerAsyncDocEntriesSource(async (locale) => {
  const entries = await loadDocEntries()
  const i18n = await getEffectiveI18nConfig()
  const currentVersionIds = getCurrentVersionPageIds()
  if (!locale || locale === i18n.defaultLocale) return entries.filter((entry) => isSearchable(entry, currentVersionIds))
  if (!i18n.locales.some((item) => item.code === locale)) return []
  const translated = await Promise.all(entries.map(async (entry) => {
    if (!isSearchable(entry, currentVersionIds)) return null
    const metadata = await getIndexableDocTranslation(entry.slug, locale)
    if (!metadata) return null
    return {
      id: entry.id,
      title: metadata.title ?? entry.title,
      description: metadata.description ?? entry.description,
      keywords: metadata.keywords ?? entry.keywords,
      href: localizedPath(entry.href, locale, i18n.defaultLocale),
    }
  }))
  return translated.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
})
registerAsyncContentDocumentSource((pageId, locale) => loadContentDocument(pageId, locale))
