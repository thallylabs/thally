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
import { JsonLdScript } from '@/components/seo/json-ld-script'
import { buildAgentAlternateLinks } from '@/lib/agent-discovery'
import { buildDocPageJsonLd } from '@/lib/json-ld'
import { buildOgImageUrl, formatOgBreadcrumb, formatOgDisplayUrl } from '@/lib/og'
import { getBuildI18nConfig } from '@/lib/i18n/request'
import { getContentI18nConfig } from '@/lib/i18n/content'
import { buildLocaleAlternates } from '@/lib/i18n/metadata'
import { resolveBuildSiteConfig } from '@/lib/site-config'

interface PageProps {
  params: Promise<{ slug?: Array<string> }>
}

export async function generateStaticParams() {
  // Remote content sources resolve pages at request time: baking today's page
  // list into static HTML would freeze content (and 404s) at build time.
  // Unknown slugs still 404 through the same notFound() path below.
  if (isRemoteContentSource()) return []
  const docs = getDocEntries()
  return docs.map((doc) =>
    doc.slug.length ? { slug: doc.slug } : { slug: [] },
  )
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolved = await params
  const doc = await getDocFromParams(resolved.slug)
  if (!doc) {
    return {}
  }

  const siteUrl = getSiteUrl()
  const primaryHref = doc.slug.length ? `/${doc.slug.join('/')}` : '/'
  const i18n = await getContentI18nConfig(
    resolved.slug,
    getBuildI18nConfig(),
  )
  const nav = await loadNavContext(doc.id)

  const ogImageUrl = buildOgImageUrl({
    title: doc.title,
    description: doc.description,
    crumb: formatOgBreadcrumb(nav.breadcrumb, doc.title, doc.group),
    url: formatOgDisplayUrl(primaryHref, siteUrl),
  })

  const isNoindex = doc.noindex || doc.hidden

  return {
    title: doc.title,
    description: doc.description,
    ...(isNoindex ? { robots: { index: false, follow: false } } : {}),
    alternates: {
      canonical: `${siteUrl}${primaryHref}`,
      languages: buildLocaleAlternates(siteUrl, primaryHref, i18n),
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
  const resolved = await params
  const doc = await getDocFromParams(resolved.slug)

  if (!doc) {
    notFound()
  }

  const siteUrl = getSiteUrl()
  const effectiveSite = resolveBuildSiteConfig()
  const primaryHref = doc.slug.length ? `/${doc.slug.join('/')}` : '/'
  const pageUrl = `${siteUrl}${primaryHref}`
  const locale = getBuildI18nConfig().defaultLocale
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
    locale,
    breadcrumb: nav.breadcrumb,
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
          <div lang={locale}>
            <ApiLayout>
              <OperationPanel operation={operationNode.operation} />
            </ApiLayout>
          </div>
      </div>
    )
  }

  const Content = doc.component

  return (
    <DocLayout doc={doc} locale={locale}>
      <JsonLdScript data={jsonLd} />
      <Content />
    </DocLayout>
  )
}
