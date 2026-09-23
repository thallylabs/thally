import type { MetadataRoute } from 'next'
import { loadDocEntries } from '@/data/docs'
import { getAllApiOperationNodes } from '@/data/api-reference'

import { getRequestOrigin } from '@/lib/cloud-link/request'
import { localizedPath } from '@/lib/i18n/config'
import { getContentI18nConfig } from '@/lib/i18n/content'
import { buildLocaleAlternates } from '@/lib/i18n/metadata'
import { getEffectiveI18nConfig } from '@/lib/i18n/request'
import { getIndexableDocTranslation } from '@/data/get-doc'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = await getRequestOrigin()
  const docEntries = (await loadDocEntries()).filter((doc) => !doc.hidden && !doc.noindex)
  const apiNodes = await getAllApiOperationNodes()
  const i18n = await getEffectiveI18nConfig()

  const docPages: MetadataRoute.Sitemap = (
    await Promise.all(
      docEntries.map(async (doc) => {
        const availableI18n = await getContentI18nConfig(doc.slug, i18n)
        const languages = buildLocaleAlternates(baseUrl, doc.href, availableI18n)
        return Promise.all(availableI18n.locales.map(async (locale) => {
          const translation = locale.code === i18n.defaultLocale
            ? null
            : await getIndexableDocTranslation(doc.slug, locale.code)
          // Build/check-out mtimes do not prove when prose changed. Only an
          // authored date can safely become a crawler-visible lastmod value.
          const updated = locale.code === i18n.defaultLocale
            ? doc.lastUpdated
            : translation?.lastUpdated
          return {
            url: `${baseUrl}${localizedPath(doc.href, locale.code, i18n.defaultLocale)}`,
            changeFrequency: 'weekly' as const,
            priority: doc.href === '/' ? 1.0 : 0.7,
            alternates: { languages },
            ...(updated && !Number.isNaN(new Date(updated).valueOf())
              ? { lastModified: new Date(updated) }
              : {}),
          }
        }))
      }),
    )
  ).flat()

  const apiPages: MetadataRoute.Sitemap = apiNodes.map((node) => ({
    url: `${baseUrl}${node.href}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }))

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/changelog`,
      changeFrequency: 'weekly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/llms.txt`,
      changeFrequency: 'weekly',
      priority: 0.4,
    },
    {
      url: `${baseUrl}/ai.txt`,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ]

  return [...docPages, ...apiPages, ...staticPages]
}
