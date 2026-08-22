import { type NextRequest, NextResponse } from 'next/server'
import { apiReferenceConfig } from '@/config/api-reference'
import { getSpecConfig, loadSpecDocument } from '@/lib/openapi/fetch'
import { buildDocumentationApiOpenApi } from '@/lib/openapi/documentation-api'
import { resolveDocumentationAccessMode } from '@/lib/openapi/documentation-access'
import { problemResponse } from '@/lib/http/problem'
import { resolveSiteConfig } from '@/lib/site-config'
import type { OpenAPIDocument } from '@/lib/openapi/types'

function getDefaultSpecConfig() {
  if (apiReferenceConfig.specs.length === 0) {
    return null
  }

  return getSpecConfig(apiReferenceConfig, apiReferenceConfig.defaultSpecId)
}

export async function GET(request: NextRequest) {
  const specConfig = getDefaultSpecConfig()
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
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
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
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
