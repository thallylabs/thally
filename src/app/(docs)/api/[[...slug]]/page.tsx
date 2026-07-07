import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ApiLayout } from '@/components/api/api-layout'
import { OperationPanel } from '@/components/api/operation-panel'
import { DocLayout } from '@/components/docs/doc-layout'
import { getSiteUrl } from '@/lib/site-url'
import { JsonLdScript } from '@/components/seo/json-ld-script'
import { apiReferenceConfig, getOpenApiSpecUrl } from '@/config/api-reference'
import { getAllApiOperationNodes, getApiOperationBySlug, getApiOperationNodes } from '@/data/api-reference'
import { getBreadcrumbs, getDocEntries } from '@/data/docs'
import { getDocFromParams } from '@/data/get-doc'
import { buildAgentAlternateLinks } from '@/lib/agent-discovery'
import { buildApiOperationJsonLd, buildDocPageJsonLd } from '@/lib/json-ld'

interface PageProps {
  params: Promise<{ slug?: Array<string> }>
}

export async function generateStaticParams() {
  const apiNodes = await getAllApiOperationNodes()
  const apiParams = apiNodes.map((node) => ({ slug: node.slug }))

  // Include MDX pages nested under src/content/api/ (e.g. api/overview.mdx → slug: ['overview'])
  const mdxParams = getDocEntries()
    .filter((doc) => doc.slug[0] === 'api' && doc.slug.length > 1)
    .map((doc) => ({ slug: doc.slug.slice(1) }))

  return [...mdxParams, ...apiParams]
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolved = await params
  const siteUrl = getSiteUrl()
  const specUrl = getOpenApiSpecUrl(siteUrl)

  const node = await getApiOperationBySlug(resolved.slug)
  if (node) {
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

  const doc = await getDocFromParams(['api', ...(resolved.slug ?? [])])
  if (doc) {
    const primaryHref = doc.href
    return {
      title: doc.title,
      description: doc.description,
      alternates: {
        types: buildAgentAlternateLinks(primaryHref),
      },
    }
  }

  return {}
}

export default async function ApiReferencePage({ params }: PageProps) {
  const resolved = await params
  const siteUrl = getSiteUrl()
  const specUrl = getOpenApiSpecUrl(siteUrl)

  // No slug — redirect to the first MDX page in the API group if one exists,
  // otherwise fall through to the first OpenAPI operation.
  if (!resolved.slug?.length) {
    const firstMdx = getDocEntries().find((doc) => doc.slug[0] === 'api' && doc.slug.length > 1)
    if (firstMdx) {
      redirect(firstMdx.href)
    }
    const defaultNodes = await getApiOperationNodes(apiReferenceConfig.defaultSpecId)
    if (defaultNodes.length > 0) {
      redirect(defaultNodes[0].href)
    }
    notFound()
  }

  // OpenAPI operation match
  const node = await getApiOperationBySlug(resolved.slug)
  if (node) {
    const pageUrl = `${siteUrl}${node.href}`
    const jsonLd = buildApiOperationJsonLd({
      siteUrl,
      pageUrl,
      title: node.operation.title,
      description: node.operation.description ?? `${node.operation.method} ${node.operation.path}`,
      specUrl: specUrl ?? undefined,
      method: node.operation.method,
      path: node.operation.path,
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

  // MDX page fallback (e.g. /api/overview → src/content/api/overview.mdx)
  const doc = await getDocFromParams(['api', ...resolved.slug])
  if (!doc) {
    notFound()
  }

  const pageUrl = `${siteUrl}${doc.href}`
  const jsonLd = buildDocPageJsonLd({
    siteUrl,
    pageUrl,
    id: doc.id,
    title: doc.title,
    description: doc.description,
    keywords: doc.keywords,
    lastUpdated: doc.lastUpdated,
    breadcrumb: getBreadcrumbs(doc.href),
  })

  const Content = doc.component
  return (
    <DocLayout doc={doc}>
      <JsonLdScript data={jsonLd} />
      <Content />
    </DocLayout>
  )
}
