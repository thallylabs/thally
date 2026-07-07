import { apiReferenceConfig } from '@/config/api-reference'
import { getSpecConfig, loadSpecDocument } from '@/lib/openapi/fetch'
import { stringify as stringifyYaml } from 'yaml'

function getDefaultSpecConfig() {
  if (apiReferenceConfig.specs.length === 0) {
    return null
  }

  return getSpecConfig(apiReferenceConfig, apiReferenceConfig.defaultSpecId)
}

export async function GET() {
  const specConfig = getDefaultSpecConfig()
  if (!specConfig) {
    return Response.json(
      { error: 'openapi_not_configured', message: 'No OpenAPI specification is configured.' },
      { status: 404 },
    )
  }

  const document = await loadSpecDocument(specConfig)
  const body = stringifyYaml(document)

  return new Response(body, {
    headers: {
      'Content-Type': 'application/yaml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
