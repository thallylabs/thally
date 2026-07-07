import { siteConfig } from '@/data/site'

const SCHEMA_CONTEXT = 'https://schema.org'

export interface BreadcrumbJsonLdItem {
  label: string
  href?: string
}

export interface SiteJsonLdOptions {
  siteUrl: string
  siteName?: string
  description?: string
  repoUrl?: string
  locale?: string
}

export interface DocJsonLdOptions {
  siteUrl: string
  siteName?: string
  pageUrl: string
  id: string
  title: string
  description?: string
  keywords?: Array<string>
  lastUpdated?: string
  locale?: string
  breadcrumb?: Array<BreadcrumbJsonLdItem>
}

export interface ApiOperationJsonLdOptions {
  siteUrl: string
  siteName?: string
  pageUrl: string
  title: string
  description?: string
  specUrl?: string
  method?: string
  path?: string
  locale?: string
  breadcrumb?: Array<BreadcrumbJsonLdItem>
}

function organizationRef(siteUrl: string) {
  return { '@id': `${siteUrl}/#organization` }
}

function websiteRef(siteUrl: string) {
  return { '@id': `${siteUrl}/#website` }
}

export function buildBreadcrumbListJsonLd(
  items: Array<BreadcrumbJsonLdItem>,
  siteUrl: string,
  pageUrl: string,
) {
  if (items.length === 0) return null

  const listItems = items.map((item, index) => {
    const isLast = index === items.length - 1
    const itemUrl = item.href ? `${siteUrl}${item.href}` : isLast ? pageUrl : undefined

    return {
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      ...(itemUrl ? { item: itemUrl } : {}),
    }
  })

  return {
    '@type': 'BreadcrumbList',
    '@id': `${pageUrl}/#breadcrumb`,
    itemListElement: listItems,
  }
}

export function buildSiteJsonLd({
  siteUrl,
  siteName = siteConfig.name,
  description = siteConfig.description,
  repoUrl = siteConfig.repoUrl,
  locale = 'en',
}: SiteJsonLdOptions) {
  const organization: Record<string, unknown> = {
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: siteName,
    url: siteUrl,
  }

  if (repoUrl && !repoUrl.includes('your-org')) {
    organization.sameAs = [repoUrl]
  }

  return {
    '@context': SCHEMA_CONTEXT,
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        name: siteName,
        url: siteUrl,
        description,
        inLanguage: locale,
        publisher: organizationRef(siteUrl),
      },
      organization,
    ],
  }
}

export function buildDocPageJsonLd({
  siteUrl,
  siteName = siteConfig.name,
  pageUrl,
  id,
  title,
  description,
  keywords,
  lastUpdated,
  locale = 'en',
  breadcrumb,
}: DocJsonLdOptions) {
  const article: Record<string, unknown> = {
    '@type': 'TechArticle',
    '@id': `${pageUrl}/#article`,
    headline: title,
    name: title,
    url: pageUrl,
    identifier: id,
    inLanguage: locale,
    isPartOf: websiteRef(siteUrl),
    publisher: organizationRef(siteUrl),
    author: {
      '@type': 'Organization',
      name: siteName,
    },
  }

  if (description) article.description = description
  if (lastUpdated) article.dateModified = lastUpdated
  if (keywords?.length) article.keywords = keywords.join(', ')

  const graph: Array<Record<string, unknown>> = [article]
  const breadcrumbList = breadcrumb ? buildBreadcrumbListJsonLd(breadcrumb, siteUrl, pageUrl) : null
  if (breadcrumbList) graph.push(breadcrumbList)

  return {
    '@context': SCHEMA_CONTEXT,
    '@graph': graph,
  }
}

export function buildApiOperationJsonLd({
  siteUrl,
  pageUrl,
  title,
  description,
  specUrl,
  method,
  path,
  locale = 'en',
  breadcrumb,
}: ApiOperationJsonLdOptions) {
  const article: Record<string, unknown> = {
    '@type': 'TechArticle',
    '@id': `${pageUrl}/#article`,
    headline: title,
    name: title,
    url: pageUrl,
    inLanguage: locale,
    isPartOf: websiteRef(siteUrl),
    publisher: organizationRef(siteUrl),
    about: {
      '@type': 'WebAPI',
      name: 'API Reference',
      ...(method && path ? { documentation: `${method.toUpperCase()} ${path}` } : {}),
    },
  }

  if (description) article.description = description
  if (specUrl) article.isBasedOn = specUrl

  const graph: Array<Record<string, unknown>> = [article]
  const breadcrumbList = breadcrumb ? buildBreadcrumbListJsonLd(breadcrumb, siteUrl, pageUrl) : null
  if (breadcrumbList) graph.push(breadcrumbList)

  return {
    '@context': SCHEMA_CONTEXT,
    '@graph': graph,
  }
}

export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data)
}
