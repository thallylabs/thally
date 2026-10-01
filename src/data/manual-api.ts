/** Server-side lookup of a manual API page's operation, used by the Try It relay. */

import { deriveTitleFromSlug, getApiMdxConfig, getI18nConfig } from '@/data/docs'
import { getContentSource } from '@/lib/content-source'
import { parseFrontmatter } from '@/lib/frontmatter'
import { findDocSource } from '@/lib/i18n/translation-source'
import { buildManualOperation } from '@/lib/openapi/manual-operation'
import { pageApiMetadata } from '@/lib/openapi/page-api'
import type { NormalizedOperation } from '@/lib/openapi/types'

/**
 * Re-derive the synthetic operation from the page's own frontmatter and the
 * site's docs.json, never from anything the browser sent besides the page id.
 * Reads the page source directly rather than going through get-doc, so the
 * relay route does not bundle the MDX render pipeline. Mirrors the manual
 * operation get-doc builds for the page itself.
 */
export async function getManualApiOperation(pageId: string, locale?: string): Promise<NormalizedOperation | null> {
  const segments = pageId.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) return null
  // Default-locale page ids never start with a locale directory (the docs
  // route strips it), and the locale must arrive only through `locale`. Compare
  // case-insensitively: a case-insensitive filesystem reads `FR/` as `fr/`.
  const first = segments[0].toLowerCase()
  if (getI18nConfig()?.locales.some((entry) => entry.code.toLowerCase() === first)) return null
  // The locale comes from the browser and becomes a content directory, so it
  // must be one the site configures.
  if (locale !== undefined && !getI18nConfig()?.locales.some((entry) => entry.code === locale)) return null
  const slugPath = segments.join('/')
  const source = getContentSource()
  const candidate = await findDocSource(source, slugPath, locale)
  if (!candidate) return null
  const file = await source.read(candidate.filePath)
  if (!file) return null
  const { data, content } = parseFrontmatter(file.content)
  if (!pageApiMetadata(data).manual) return null
  return buildManualOperation({
    pageId: slugPath,
    title: typeof data.title === 'string' ? data.title : deriveTitleFromSlug(slugPath),
    api: data.api,
    authMethod: data.authMethod,
    mdx: content,
    config: getApiMdxConfig(),
    locale,
  })
}
