import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ApiLayout } from '@/components/api/api-layout'
import { OperationPanel } from '@/components/api/operation-panel'
import { JsonLdScript } from '@/components/seo/json-ld-script'
import { getSiteUrl } from '@/lib/site-url'
import { apiReferenceConfig, getOpenApiSpecUrl } from '@/config/api-reference'
import { getAllApiOperationNodes, getApiOperationBySlug, getApiOperationNodes } from '@/data/api-reference'
import { getBreadcrumbs } from '@/data/docs'
import { buildAgentAlternateLinks } from '@/lib/agent-discovery'
import { buildApiOperationJsonLd } from '@/lib/json-ld'
import { buildOgImageUrl, formatOgBreadcrumb, formatOgDisplayUrl } from '@/lib/og'
import { localeDirection, type I18nConfig } from '@/lib/i18n/config'
import {
  getBuildI18nConfig,
  getRepositoryI18nConfig,
} from '@/lib/i18n/request'
import { resolveBuildSiteConfig } from '@/lib/site-config'

interface PageProps {
  params: Promise<{ locale: string; slug?: Array<string> }>
}

function isValidSecondaryLocale(locale: string, i18n: I18nConfig): boolean {
  return i18n.locales.some((l) => l.code === locale && l.code !== i18n.defaultLocale)
}

export async function generateStaticParams() {
  const i18n = getRepositoryI18nConfig()
  const secondaryLocales = i18n.locales.filter((l) => l.code !== i18n.defaultLocale)
  const nodes = await getAllApiOperationNodes()
  return secondaryLocales.flatMap(({ code }) => nodes.map((node) => ({ locale: code, slug: node.slug })))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolved = await params
  const i18n = getBuildI18nConfig()
  if (!isValidSecondaryLocale(resolved.locale, i18n)) return {}
  const siteUrl = getSiteUrl()
  const specUrl = getOpenApiSpecUrl(siteUrl)
  const node = await getApiOperationBySlug(resolved.slug)
  if (!node) return {}
  const title = node.operation.title
  const description = node.operation.description ?? `${node.operation.method} ${node.operation.path}`
  const ogImageUrl = buildOgImageUrl({
    title,
    description,
    crumb: formatOgBreadcrumb(getBreadcrumbs(node.href), title, 'API Reference'),
    url: formatOgDisplayUrl(node.href, siteUrl),
  })

  return {
    title,
    description,
    robots: { index: false, follow: true },
    alternates: {
      // OpenAPI operation prose is source-language content. Localized routes
      // provide localized navigation without claiming a translated document.
      canonical: `${siteUrl}${node.href}`,
      types: {
        ...buildAgentAlternateLinks(node.href, siteUrl),
        ...(specUrl ? { 'application/vnd.oai.openapi': specUrl } : {}),
      },
    },
    openGraph: {
      title,
      description,
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  }
}

export default async function LocaleApiReferencePage({ params }: PageProps) {
  const resolved = await params
  const siteUrl = getSiteUrl()
  const specUrl = getOpenApiSpecUrl(siteUrl)
  const i18n = getBuildI18nConfig()
  const effectiveSite = resolveBuildSiteConfig()

  if (!isValidSecondaryLocale(resolved.locale, i18n)) {
    notFound()
  }

  if (!resolved.slug?.length) {
    const defaultNodes = await getApiOperationNodes(apiReferenceConfig.defaultSpecId)
    if (defaultNodes.length > 0) {
      redirect(`/${resolved.locale}${defaultNodes[0].href}`)
    }
    notFound()
  }

  const node = await getApiOperationBySlug(resolved.slug)
  if (!node) {
    notFound()
  }

  const pageUrl = `${siteUrl}${node.href}`
  const jsonLd = buildApiOperationJsonLd({
    siteUrl,
    siteName: effectiveSite.name,
    pageUrl,
    title: node.operation.title,
    description: node.operation.description ?? `${node.operation.method} ${node.operation.path}`,
    specUrl: specUrl ?? undefined,
    method: node.operation.method,
    path: node.operation.path,
    locale: i18n.defaultLocale,
    breadcrumb: getBreadcrumbs(node.href),
  })

  return (
    <div lang={i18n.defaultLocale} dir={localeDirection(i18n.defaultLocale)}>
      <ApiLayout>
        {specUrl ? (
          <p className="text-sm text-foreground/60">
            OpenAPI specification:{' '}
            <a href={specUrl} className="underline decoration-border underline-offset-2 hover:text-foreground">
              {specUrl}
            </a>
          </p>
        ) : null}
        <JsonLdScript data={jsonLd} />
        <OperationPanel operation={node.operation} />
      </ApiLayout>
    </div>
  )
}
