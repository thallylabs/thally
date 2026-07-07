import { NextResponse } from 'next/server'
import { apiReferenceConfig } from '@/config/api-reference'
import { getSpecConfig, loadSpecDocument } from '@/lib/openapi/fetch'

function getDefaultSpecConfig() {
  if (apiReferenceConfig.specs.length === 0) {
    return null
  }

  return getSpecConfig(apiReferenceConfig, apiReferenceConfig.defaultSpecId)
}

export async function GET() {
  const specConfig = getDefaultSpecConfig()
  if (!specConfig) {
    return NextResponse.json(
      { error: 'openapi_not_configured', message: 'No OpenAPI specification is configured.' },
      { status: 404 },
    )
  }

  const document = await loadSpecDocument(specConfig)

  return NextResponse.json(document, {
    headers: {
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
