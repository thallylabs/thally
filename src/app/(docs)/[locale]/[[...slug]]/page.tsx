/**
 * Locale-prefixed documentation pages. Selected languages become routable
 * immediately, while crawler metadata distinguishes real translations from
 * source-language fallbacks.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DocLayout } from '@/components/docs/doc-layout'
import { getDocEntries, loadNavContext } from '@/data/docs'
import { getDocFromParams } from '@/data/get-doc'
import { isRemoteContentSource } from '@/lib/content-source'
import { getSiteUrl } from '@/lib/site-url'
import { getApiOperationByKey } from '@/data/api-reference'
import { DocHeader } from '@/components/docs/doc-header'
import { ApiLayout } from '@/components/api/api-layout'
import { OperationPanel } from '@/components/api/operation-panel'
import { LocaleFallbackBanner } from '@/components/docs/locale-fallback-banner'
import { LocaleStaleBanner } from '@/components/docs/locale-stale-banner'
import { JsonLdScript } from '@/components/seo/json-ld-script'
import { buildAgentAlternateLinks } from '@/lib/agent-discovery'
import { buildDocPageJsonLd } from '@/lib/json-ld'
import { buildOgImageUrl, formatOgBreadcrumb, formatOgDisplayUrl } from '@/lib/og'
import { localizedPath, type I18nConfig } from '@/lib/i18n/config'
import { getContentI18nConfig } from '@/lib/i18n/content'
import { buildLocaleAlternates } from '@/lib/i18n/metadata'
import {
  getBuildI18nConfig,
  getRepositoryI18nConfig,
} from '@/lib/i18n/request'
import { resolveBuildSiteConfig } from '@/lib/site-config'
import { hasDocTranslation } from '@/data/get-doc'

interface PageProps {
  params: Promise<{ locale: string; slug?: Array<string> }>
}

function isValidSecondaryLocale(locale: string, config: I18nConfig): boolean {
  return config.locales.some(
    (candidate) =>
      candidate.code === locale && candidate.code !== config.defaultLocale,
  )
}

export async function generateStaticParams() {
  // Live settings add routes on demand. Repository locales are still emitted
  // at build time for fully static/self-hosted deployments.
  if (isRemoteContentSource()) return []
  const i18n = getRepositoryI18nConfig()
  const docs = getDocEntries()
  const secondaryLocales = i18n.locales.filter(
    (locale) => locale.code !== i18n.defaultLocale,
  )
  const params = await Promise.all(
    secondaryLocales.flatMap(({ code }) =>
      docs.map(async (doc) =>
        (await hasDocTranslation(doc.slug, code))
          ? { locale: code, slug: doc.slug.length ? doc.slug : [] }
          : null,
      ),
    ),
  )
  return params.filter(
    (entry): entry is { locale: string; slug: Array<string> } => entry !== null,
  )
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolved = await params
  const effectiveI18n = getBuildI18nConfig()
  const isLocaleRoute = isValidSecondaryLocale(resolved.locale, effectiveI18n)
  const slug = isLocaleRoute
    ? resolved.slug
    : [resolved.locale, ...(resolved.slug ?? [])]
  const doc = await getDocFromParams(
    slug,
    isLocaleRoute ? resolved.locale : undefined,
  )
  if (!doc) return {}

  const siteUrl = getSiteUrl()
  const primaryHref = doc.slug.length ? `/${doc.slug.join('/')}` : '/'
  const requestedHref = isLocaleRoute
    ? localizedPath(primaryHref, resolved.locale, effectiveI18n.defaultLocale)
    : primaryHref
  const hasTranslation = !isLocaleRoute || !doc.isFallback
  const canonicalHref = hasTranslation ? requestedHref : primaryHref
  const availableI18n = await getContentI18nConfig(slug, effectiveI18n)
  const nav = await loadNavContext(doc.id)
  const ogImageUrl = buildOgImageUrl({
    title: doc.title,
    description: doc.description,
    crumb: formatOgBreadcrumb(nav.breadcrumb, doc.title, doc.group),
    url: formatOgDisplayUrl(canonicalHref, siteUrl),
  })
  const isNoindex = doc.noindex || doc.hidden || !hasTranslation

  return {
    title: doc.title,
    description: doc.description,
    ...(isNoindex
      ? { robots: { index: false, follow: !doc.noindex && !doc.hidden } }
      : {}),
    alternates: {
      canonical: `${siteUrl}${canonicalHref}`,
      languages: buildLocaleAlternates(siteUrl, primaryHref, availableI18n),
      types: buildAgentAlternateLinks(primaryHref, siteUrl),
    },
    openGraph: {
      title: doc.title,
      description: doc.description,
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: doc.title,
      description: doc.description,
      images: [ogImageUrl],
    },
  }
}

export default async function LocaleDocsPage({ params }: PageProps) {
  const resolved = await params
  const siteUrl = getSiteUrl()
  const i18n = getBuildI18nConfig()
  const effectiveSite = resolveBuildSiteConfig()
  const isLocaleRoute = isValidSecondaryLocale(resolved.locale, i18n)
  const slug = isLocaleRoute
    ? resolved.slug
    : [resolved.locale, ...(resolved.slug ?? [])]
  const doc = await getDocFromParams(
    slug,
    isLocaleRoute ? resolved.locale : undefined,
  )
  if (!doc) notFound()

  const primaryHref = doc.slug.length ? `/${doc.slug.join('/')}` : '/'
  const contentLocale =
    isLocaleRoute && !doc.isFallback
      ? resolved.locale
      : i18n.defaultLocale
  const canonicalHref =
    isLocaleRoute && !doc.isFallback
      ? localizedPath(primaryHref, resolved.locale, i18n.defaultLocale)
      : primaryHref
  const pageUrl = `${siteUrl}${canonicalHref}`
  const nav = await loadNavContext(doc.id)
  const jsonLd = buildDocPageJsonLd({
    siteUrl,
    siteName: effectiveSite.name,
    pageUrl,
    id: doc.id,
    title: doc.title,
    description: doc.description,
    keywords: doc.keywords,
    lastUpdated: doc.lastUpdated,
    locale: contentLocale,
    breadcrumb: nav.breadcrumb,
  })
  const localeNotice =
    isLocaleRoute && doc.isFallback ? (
      <LocaleFallbackBanner
        locale={resolved.locale}
        defaultLocale={i18n.defaultLocale}
      />
    ) : isLocaleRoute && doc.isStale ? (
      <LocaleStaleBanner primaryHref={primaryHref} />
    ) : null

  if (doc.openapi) {
    const operationNode = await getApiOperationByKey(
      doc.openapi.method,
      doc.openapi.path,
      doc.openapi.specId,
    )
    if (!operationNode) notFound()

    return (
      <div className="space-y-10" lang={contentLocale}>
        <JsonLdScript data={jsonLd} />
        {localeNotice}
        <div className="not-prose">
          <DocHeader doc={doc} />
        </div>
        <ApiLayout>
          <OperationPanel operation={operationNode.operation} />
        </ApiLayout>
      </div>
    )
  }

  const Content = doc.component

  return (
    <DocLayout doc={doc} locale={contentLocale}>
      <JsonLdScript data={jsonLd} />
      {localeNotice}
      <Content />
    </DocLayout>
  )
}
