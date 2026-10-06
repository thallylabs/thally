import { type NextRequest, NextResponse } from 'next/server'
import { apiReferenceConfig } from '@/config/api-reference'
import { getSpecConfig, loadSpecDocument } from '@/lib/openapi/fetch'
import { buildDocumentationApiOpenApi } from '@/lib/openapi/documentation-api'
import { resolveDocumentationAccessMode } from '@/lib/openapi/documentation-access'
import { problemResponse } from '@/lib/http/problem'
import { resolveSiteConfig } from '@/lib/site-config'
import type { OpenAPIDocument } from '@/lib/openapi/types'
import { getReaderAuthConfig } from '@/lib/reader-auth/config'
import { canReaderAccessUnmarkedContent } from '@/lib/reader-auth/access'
import { getReaderContextFromRequest } from '@/lib/reader-auth/context'
import { contentCacheControl } from '@/lib/reader-auth/cache'

function getDefaultSpecConfig() {
  if (apiReferenceConfig.specs.length === 0) {
    return null
  }

  return getSpecConfig(apiReferenceConfig, apiReferenceConfig.defaultSpecId)
}

export async function GET(request: NextRequest) {
  const specConfig = getDefaultSpecConfig()
  // The customer's API description is site content without page frontmatter:
  // it follows the site default visibility, and a reader who may not see it
  // gets the same 404 as a site without a specification.
  if (specConfig && !canReaderAccessUnmarkedContent(await getReaderContextFromRequest(request), getReaderAuthConfig())) {
    return problemResponse({
      status: 404,
      code: 'not_found',
      title: 'Not found',
      detail: 'No OpenAPI specification is available.',
      resolution: 'Sign in to the documentation site, or present a reader token, and retry.',
      instance: request.nextUrl.pathname,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }
  if (!specConfig) {
    const [site, accessMode] = await Promise.all([
      resolveSiteConfig(request.nextUrl.origin),
      resolveDocumentationAccessMode(request.nextUrl.origin),
    ])
    return NextResponse.json(
      buildDocumentationApiOpenApi(request.nextUrl.origin, site.name, {
        accessMode,
      }),
      {
        headers: {
          'Cache-Control': contentCacheControl('public, s-maxage=3600, stale-while-revalidate=86400'),
        },
      },
    )
  }

  let document: OpenAPIDocument
  try {
    document = await loadSpecDocument(specConfig)
  } catch {
    return problemResponse({
      status: 502,
      code: 'openapi_unavailable',
      title: 'OpenAPI specification unavailable',
      detail: 'The configured OpenAPI specification could not be loaded.',
      resolution: 'Check the configured specification source and try again.',
      instance: request.nextUrl.pathname,
    })
  }

  return NextResponse.json(document, {
    headers: {
      'Cache-Control': contentCacheControl('public, s-maxage=3600, stale-while-revalidate=86400'),
    },
  })
}
