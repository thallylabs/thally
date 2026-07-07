import type { ApiReferenceConfig, ApiSpecConfig, ApiSpecSource } from '@/lib/openapi/types'
import { getSidebarCollections } from '@/data/docs'
import type { DocsJsonApiConfig } from '@/data/docs'
import { getSiteUrl } from '@/lib/site-url'

function buildApiReferenceConfig(): ApiReferenceConfig {
  const collections = getSidebarCollections()
  const apiCollection = collections.find((c) => c.api)
  const apiConfig = apiCollection?.api

  if (!apiConfig) {
    return { defaultSpecId: 'default', specs: [] }
  }

  return {
    defaultSpecId: 'default',
    specs: [buildSpecFromDocsJson(apiConfig)],
  }
}

function buildSpecFromDocsJson(api: DocsJsonApiConfig): ApiSpecConfig {
  const isUrl = api.source.startsWith('http://') || api.source.startsWith('https://')
  return {
    id: 'default',
    label: 'API Reference',
    source: isUrl
      ? { type: 'url', url: api.source }
      : { type: 'file', path: api.source },
    tagsOrder: api.tagsOrder,
    defaultGroup: api.defaultGroup,
    webhookGroup: api.webhookGroup,
    operationOverrides: api.overrides,
  }
}

export const apiReferenceConfig: ApiReferenceConfig = buildApiReferenceConfig()

function normalizePublicSpecPath(path: string) {
  if (path.startsWith('/')) {
    return path
  }
  return `/${path}`
}

function resolveSourceUrl(source: ApiSpecSource, siteUrl: string): string | null {
  if (source.type === 'url') {
    return source.url
  }
  if (source.type === 'file') {
    return `${siteUrl}${normalizePublicSpecPath(source.path)}`
  }
  return null
}

export function getOpenApiSpecUrl(siteUrl = getSiteUrl()): string | null {
  const spec = apiReferenceConfig.specs.find((entry) => entry.id === apiReferenceConfig.defaultSpecId)
    ?? apiReferenceConfig.specs[0]

  if (!spec) {
    return null
  }

  return resolveSourceUrl(spec.source, siteUrl)
}

