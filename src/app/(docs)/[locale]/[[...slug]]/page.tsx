import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DocLayout } from '@/components/docs/doc-layout'
import { getDocEntries, getI18nConfig, getNavContext } from '@/data/docs'
import { getDocFromParams } from '@/data/get-doc'
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
import { buildOgImageUrl } from '@/lib/og'

interface PageProps {
  params: Promise<{ locale: string; slug?: Array<string> }>
}

function localizedHref(href: string, code: string, defaultLocale: string) {
  return code === defaultLocale ? href : `/${code}${href}`
}

function isValidSecondaryLocale(locale: string): boolean {
  const i18n = getI18nConfig()
  if (!i18n) return false
  return i18n.locales.some((l) => l.code === locale && l.code !== i18n.defaultLocale)
}

export async function generateStaticParams() {
  const i18n = getI18nConfig()
  if (!i18n) return []
  const docs = getDocEntries()
  const secondaryLocales = i18n.locales.filter((l) => l.code !== i18n.defaultLocale)
  return secondaryLocales.flatMap(({ code }) =>
    docs.map((doc) => ({
      locale: code,
      slug: doc.slug.length ? doc.slug : [],
    })),
  )
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolved = await params
  const i18n = getI18nConfig()

  if (!isValidSecondaryLocale(resolved.locale)) {
    // Intercepted from [[...slug]] — treat locale segment as part of the doc slug
    const allSlug = [resolved.locale, ...(resolved.slug ?? [])]
    const doc = await getDocFromParams(allSlug)
    if (!doc) return {}

    const siteUrl = getSiteUrl()
    const primaryHref = doc.slug.length ? `/${doc.slug.join('/')}` : '/'
    const ogImageUrl = buildOgImageUrl({
      title: doc.title,
      description: doc.description,
      group: doc.group,
    })
    const alternateLanguages = i18n
      ? Object.fromEntries(
          i18n.locales.map((l) => [l.code, `${siteUrl}${localizedHref(primaryHref, l.code, i18n.defaultLocale)}`]),
        )
      : {}

    return {
      title: doc.title,
      description: doc.description,
      alternates: {
        canonical: `${siteUrl}${primaryHref}`,
        ...(i18n ? { languages: alternateLanguages } : {}),
        types: buildAgentAlternateLinks(primaryHref),
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

  const doc = await getDocFromParams(resolved.slug, resolved.locale)
  if (!doc) return {}

  const siteUrl = getSiteUrl()
  const primaryHref = doc.slug.length ? `/${doc.slug.join('/')}` : '/'

  const ogImageUrl = buildOgImageUrl({
    title: doc.title,
    description: doc.description,
    group: doc.group,
  })

  const alternateLanguages = i18n
    ? Object.fromEntries(
        i18n.locales.map((l) => [l.code, `${siteUrl}${localizedHref(primaryHref, l.code, i18n.defaultLocale)}`]),
      )
    : {}

  return {
    title: doc.title,
    description: doc.description,
    alternates: {
      canonical: `${siteUrl}${primaryHref}`,
      languages: alternateLanguages,
      types: buildAgentAlternateLinks(primaryHref),
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

  if (!isValidSecondaryLocale(resolved.locale)) {
    // This path was intercepted from [[...slug]] — treat locale segment as part of the slug
    const allSlug = [resolved.locale, ...(resolved.slug ?? [])]
    const doc = await getDocFromParams(allSlug)
    if (!doc) notFound()

    const primaryHref = doc.slug.length ? `/${doc.slug.join('/')}` : '/'
    const pageUrl = `${siteUrl}${primaryHref}`
    const jsonLd = buildDocPageJsonLd({
      siteUrl,
      pageUrl,
      id: doc.id,
      title: doc.title,
      description: doc.description,
      keywords: doc.keywords,
      lastUpdated: doc.lastUpdated,
      locale: getI18nConfig()?.defaultLocale ?? 'en',
      breadcrumb: getNavContext(doc.id).breadcrumb,
    })

    if (doc.openapi) {
      const operationNode = await getApiOperationByKey(doc.openapi.method, doc.openapi.path, doc.openapi.specId)
      if (!operationNode) notFound()

      return (
        <div className="space-y-10">
          <JsonLdScript data={jsonLd} />
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
      <DocLayout doc={doc}>
        <JsonLdScript data={jsonLd} />
        <Content />
      </DocLayout>
    )
  }

  const i18n = getI18nConfig()
  const doc = await getDocFromParams(resolved.slug, resolved.locale)

  if (!doc) {
    notFound()
  }

  const primaryHref = doc.slug.length ? `/${doc.slug.join('/')}` : '/'
  const pageUrl = `${siteUrl}/${resolved.locale}${primaryHref}`
  const jsonLd = buildDocPageJsonLd({
    siteUrl,
    pageUrl,
    id: doc.id,
    title: doc.title,
    description: doc.description,
    keywords: doc.keywords,
    lastUpdated: doc.lastUpdated,
    locale: resolved.locale,
    breadcrumb: getNavContext(doc.id).breadcrumb,
  })

  if (doc.openapi) {
    const operationNode = await getApiOperationByKey(doc.openapi.method, doc.openapi.path, doc.openapi.specId)
    if (!operationNode) {
      notFound()
    }

    return (
      <div className="space-y-10">
        <JsonLdScript data={jsonLd} />
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
    <DocLayout doc={doc}>
      <JsonLdScript data={jsonLd} />
      {doc.isFallback ? (
        <LocaleFallbackBanner locale={resolved.locale} defaultLocale={i18n?.defaultLocale ?? 'en'} />
      ) : doc.isStale ? (
        <LocaleStaleBanner primaryHref={primaryHref} />
      ) : null}
      <Content />
    </DocLayout>
  )
}
