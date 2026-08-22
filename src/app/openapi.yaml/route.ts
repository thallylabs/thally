import { type NextRequest } from 'next/server'
import { apiReferenceConfig } from '@/config/api-reference'
import { getSpecConfig, loadSpecDocument } from '@/lib/openapi/fetch'
import { buildDocumentationApiOpenApi } from '@/lib/openapi/documentation-api'
import { resolveDocumentationAccessMode } from '@/lib/openapi/documentation-access'
import { problemResponse } from '@/lib/http/problem'
import { resolveSiteConfig } from '@/lib/site-config'
import type { OpenAPIDocument } from '@/lib/openapi/types'
import { stringify as stringifyYaml } from 'yaml'

function getDefaultSpecConfig() {
  if (apiReferenceConfig.specs.length === 0) {
    return null
  }

  return getSpecConfig(apiReferenceConfig, apiReferenceConfig.defaultSpecId)
}

export async function GET(request: NextRequest) {
  const specConfig = getDefaultSpecConfig()
  let document: OpenAPIDocument

  if (specConfig) {
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
  } else {
    const [site, accessMode] = await Promise.all([
      resolveSiteConfig(request.nextUrl.origin),
      resolveDocumentationAccessMode(request.nextUrl.origin),
    ])
    document = buildDocumentationApiOpenApi(request.nextUrl.origin, site.name, {
      accessMode,
    })
  }

  const body = stringifyYaml(document)

  return new Response(body, {
    headers: {
      'Content-Type': 'application/yaml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
