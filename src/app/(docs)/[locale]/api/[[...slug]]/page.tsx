import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ApiLayout } from '@/components/api/api-layout'
import { OperationPanel } from '@/components/api/operation-panel'
import { JsonLdScript } from '@/components/seo/json-ld-script'
import { getSiteUrl } from '@/lib/site-url'
import { apiReferenceConfig, getOpenApiSpecUrl } from '@/config/api-reference'
import { getAllApiOperationNodes, getApiOperationBySlug, getApiOperationNodes } from '@/data/api-reference'
import { getBreadcrumbs, getI18nConfig } from '@/data/docs'
import { buildAgentAlternateLinks } from '@/lib/agent-discovery'
import { buildApiOperationJsonLd } from '@/lib/json-ld'

interface PageProps {
  params: Promise<{ locale: string; slug?: Array<string> }>
}

function isValidSecondaryLocale(locale: string): boolean {
  const i18n = getI18nConfig()
  if (!i18n) return false
  return i18n.locales.some((l) => l.code === locale && l.code !== i18n.defaultLocale)
}

export async function generateStaticParams() {
  const i18n = getI18nConfig()
  if (!i18n) return []
  const secondaryLocales = i18n.locales.filter((l) => l.code !== i18n.defaultLocale)
  const nodes = await getAllApiOperationNodes()
  return secondaryLocales.flatMap(({ code }) =>
    nodes.map((node) => ({ locale: code, slug: node.slug })),
  )
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolved = await params
  if (!isValidSecondaryLocale(resolved.locale)) return {}
  const siteUrl = getSiteUrl()
  const specUrl = getOpenApiSpecUrl(siteUrl)
  const node = await getApiOperationBySlug(resolved.slug)
  if (!node) return {}
  return {
    title: node.operation.title,
    description: node.operation.description ?? `${node.operation.method} ${node.operation.path}`,
    alternates: {
      types: {
        ...buildAgentAlternateLinks(node.href),
        ...(specUrl ? { 'application/vnd.oai.openapi': specUrl } : {}),
      },
    },
  }
}

export default async function LocaleApiReferencePage({ params }: PageProps) {
  const resolved = await params
  const siteUrl = getSiteUrl()
  const specUrl = getOpenApiSpecUrl(siteUrl)

  if (!isValidSecondaryLocale(resolved.locale)) {
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

  const pageUrl = `${siteUrl}/${resolved.locale}${node.href}`
  const jsonLd = buildApiOperationJsonLd({
    siteUrl,
    pageUrl,
    title: node.operation.title,
    description: node.operation.description ?? `${node.operation.method} ${node.operation.path}`,
    specUrl: specUrl ?? undefined,
    method: node.operation.method,
    path: node.operation.path,
    locale: resolved.locale,
    breadcrumb: getBreadcrumbs(node.href),
  })

  return (
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
  )
}
