/**
 * The single catch-all for default and locale-prefixed documentation pages.
 * A unified route keeps the client and server App Router trees identical while
 * still resolving secondary locales from the first URL segment.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ApiLayout } from '@/components/api/api-layout'
import { OperationPanel } from '@/components/api/operation-panel'
import { DocHeader } from '@/components/docs/doc-header'
import { DocLayout } from '@/components/docs/doc-layout'
import { LocaleFallbackBanner } from '@/components/docs/locale-fallback-banner'
import { LocaleStaleBanner } from '@/components/docs/locale-stale-banner'
import { LocalizedSidebarHydrator } from '@/components/layout/localized-sidebar-hydrator'
import { JsonLdScript } from '@/components/seo/json-ld-script'
import { getApiOperationByKey } from '@/data/api-reference'
import { getDocEntries, loadNavContext } from '@/data/docs'
import { getDocFromParams, hasDocTranslation } from '@/data/get-doc'
import { buildAgentAlternateLinks } from '@/lib/agent-discovery'
import { isRemoteContentSource } from '@/lib/content-source'
import { resolveDocRoute } from '@/lib/i18n/doc-route'
import { getContentI18nConfig } from '@/lib/i18n/content'
import { localizedPath } from '@/lib/i18n/config'
import { buildLocaleAlternates } from '@/lib/i18n/metadata'
import {
  getBuildI18nConfig,
  getRepositoryI18nConfig,
} from '@/lib/i18n/request'
import { buildDocPageJsonLd } from '@/lib/json-ld'
import { buildOgImageUrl, formatOgBreadcrumb, formatOgDisplayUrl } from '@/lib/og'
import { resolveBuildSiteConfig } from '@/lib/site-config'
import { getSiteUrl } from '@/lib/site-url'

interface PageProps {
  params: Promise<{ slug?: Array<string> }>
}

export async function generateStaticParams() {
  // Remote content resolves at request time so managed deployments never bake
  // the runtime repository's own pages into the customer-facing route table.
  if (isRemoteContentSource()) return []

  const docs = getDocEntries()
  const i18n = getRepositoryI18nConfig()
  const defaultLocaleParams = docs.map((doc) => ({ slug: doc.slug }))
  const secondaryLocales = i18n.locales.filter(
    (locale) => locale.code !== i18n.defaultLocale,
  )
  const localizedParams = await Promise.all(
    secondaryLocales.flatMap(({ code }) =>
      docs.map(async (doc) =>
        (await hasDocTranslation(doc.slug, code))
          ? { slug: [code, ...doc.slug] }
          : null,
      ),
    ),
  )

  return [
    ...defaultLocaleParams,
    ...localizedParams.filter(
      (entry): entry is { slug: Array<string> } => entry !== null,
    ),
  ]
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const routeParams = await params
  const buildI18n = getBuildI18nConfig()
  const route = resolveDocRoute(routeParams.slug, buildI18n)
  const doc = await getDocFromParams(
    route.docSlug,
    route.isLocaleRoute ? route.locale : undefined,
  )
  if (!doc) return {}

  const siteUrl = getSiteUrl()
  const primaryHref = doc.slug.length ? `/${doc.slug.join('/')}` : '/'
  const requestedHref = route.isLocaleRoute
    ? localizedPath(primaryHref, route.locale, buildI18n.defaultLocale)
    : primaryHref
  const hasTranslation = !route.isLocaleRoute || !doc.isFallback
  const canonicalHref = hasTranslation ? requestedHref : primaryHref
  const availableI18n = await getContentI18nConfig(route.docSlug, buildI18n)
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

export default async function DocsPage({ params }: PageProps) {
  const routeParams = await params
  const i18n = getBuildI18nConfig()
  const route = resolveDocRoute(routeParams.slug, i18n)
  const doc = await getDocFromParams(
    route.docSlug,
    route.isLocaleRoute ? route.locale : undefined,
  )
  if (!doc) notFound()

  const siteUrl = getSiteUrl()
  const effectiveSite = resolveBuildSiteConfig()
  const primaryHref = doc.slug.length ? `/${doc.slug.join('/')}` : '/'
  const contentLocale =
    route.isLocaleRoute && !doc.isFallback
      ? route.locale
      : i18n.defaultLocale
  const canonicalHref =
    route.isLocaleRoute && !doc.isFallback
      ? localizedPath(primaryHref, route.locale, i18n.defaultLocale)
      : primaryHref
  const nav = await loadNavContext(doc.id)
  const jsonLd = buildDocPageJsonLd({
    siteUrl,
    siteName: effectiveSite.name,
    pageUrl: `${siteUrl}${canonicalHref}`,
    id: doc.id,
    title: doc.title,
    description: doc.description,
    keywords: doc.keywords,
    lastUpdated: doc.lastUpdated,
    locale: contentLocale,
    breadcrumb: nav.breadcrumb,
  })
  const localeNotice =
    route.isLocaleRoute && doc.isFallback ? (
      <LocaleFallbackBanner
        locale={route.locale}
        defaultLocale={i18n.defaultLocale}
      />
    ) : route.isLocaleRoute && doc.isStale ? (
      <LocaleStaleBanner primaryHref={primaryHref} />
    ) : null
  const localizedNavigation = route.isLocaleRoute ? (
    <LocalizedSidebarHydrator locale={route.locale} />
  ) : null

  if (doc.openapi) {
    const operationNode = await getApiOperationByKey(
      doc.openapi.method,
      doc.openapi.path,
      doc.openapi.specId,
    )
    if (!operationNode) notFound()

    return (
      <>
        {localizedNavigation}
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
      </>
    )
  }

  const Content = doc.component

  return (
    <>
      {localizedNavigation}
      <JsonLdScript data={jsonLd} />
      <DocLayout doc={doc} locale={contentLocale}>
        {localeNotice}
        <Content />
      </DocLayout>
    </>
  )
}
