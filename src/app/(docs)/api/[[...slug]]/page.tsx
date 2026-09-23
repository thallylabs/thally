import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ApiLayout } from '@/components/api/api-layout'
import { OperationPanel } from '@/components/api/operation-panel'
import { getSiteUrl } from '@/lib/site-url'
import { JsonLdScript } from '@/components/seo/json-ld-script'
import { apiReferenceConfig, getOpenApiSpecUrl } from '@/config/api-reference'
import { getAllApiOperationNodes, getApiOperationBySlug, getApiOperationNodes } from '@/data/api-reference'
import { getBreadcrumbs, getDocEntries, loadDocEntries } from '@/data/docs'
import { isRemoteContentSource } from '@/lib/content-source'
import { buildAgentAlternateLinks } from '@/lib/agent-discovery'
import { buildApiOperationJsonLd } from '@/lib/json-ld'
import { buildOgImageUrl, formatOgBreadcrumb, formatOgDisplayUrl } from '@/lib/og'
import { resolveBuildSiteConfig } from '@/lib/site-config'
import DocsPage, { generateMetadata as generateDocsMetadata } from '@/app/(docs)/[[...slug]]/page'

interface PageProps {
  params: Promise<{ slug?: Array<string> }>
}

export async function generateStaticParams() {
  // Visit the optional catch-all root so the shell can mark assets builds
  // dynamic; returning no params incorrectly selects on-demand SSG.
  if (isRemoteContentSource()) return [{ slug: [] }]
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
      alternates: {
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

  return generateDocsMetadata({ params: Promise.resolve({ slug: ['api', ...(resolved.slug ?? [])] }) })
}

export default async function ApiReferencePage({ params }: PageProps) {
  const resolved = await params
  const siteUrl = getSiteUrl()
  const effectiveSite = resolveBuildSiteConfig()
  const specUrl = getOpenApiSpecUrl(siteUrl)

  // No slug — redirect to the first MDX page in the API group if one exists,
  // otherwise fall through to the first OpenAPI operation.
  if (!resolved.slug?.length) {
    const firstMdx = (await loadDocEntries()).find(
      (doc) => doc.slug[0] === 'api' && doc.slug.length > 1,
    )
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
      siteName: effectiveSite.name,
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

  // MDX under /api is still an authored document, so share its locale,
  // robots, and hreflang behavior with the primary document route.
  return DocsPage({ params: Promise.resolve({ slug: ['api', ...resolved.slug] }) })
}
