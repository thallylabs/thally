import type { MetadataRoute } from 'next'
import { getDocEntries } from '@/data/docs'
import { getAllApiOperationNodes } from '@/data/api-reference'

import { getSiteUrl } from '@/lib/site-url'

const baseUrl = getSiteUrl()

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const docEntries = getDocEntries().filter((doc) => !doc.hidden && !doc.noindex)
  const apiNodes = await getAllApiOperationNodes()
  const now = new Date()

  const docPages: MetadataRoute.Sitemap = docEntries.map((doc) => ({
    url: `${baseUrl}${doc.href}`,
    changeFrequency: 'weekly',
    priority: doc.href === '/' ? 1.0 : 0.7,
    ...(doc.lastUpdated ? { lastModified: new Date(doc.lastUpdated) } : { lastModified: now }),
  }))

  const apiPages: MetadataRoute.Sitemap = apiNodes.map((node) => ({
    url: `${baseUrl}${node.href}`,
    changeFrequency: 'weekly',
    priority: 0.6,
    lastModified: now,
  }))

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/changelog`,
      changeFrequency: 'weekly',
      priority: 0.5,
      lastModified: now,
    },
    {
      url: `${baseUrl}/llms.txt`,
      changeFrequency: 'weekly',
      priority: 0.4,
      lastModified: now,
    },
    {
      url: `${baseUrl}/ai.txt`,
      changeFrequency: 'monthly',
      priority: 0.3,
      lastModified: now,
    },
  ]

  return [...docPages, ...apiPages, ...staticPages]
}
