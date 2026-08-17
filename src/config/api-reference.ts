/**
 * Normalizes docs.json API-reference settings for rendering and discovery.
 * Public links always target Thally's served projection, never source storage.
 */

import type { ApiReferenceConfig, ApiSpecConfig } from '@/lib/openapi/types'
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

/** Return the canonical public YAML projection for the configured specification. */
export function getOpenApiSpecUrl(siteUrl = getSiteUrl()): string | null {
  const spec = apiReferenceConfig.specs.find((entry) => entry.id === apiReferenceConfig.defaultSpecId)
    ?? apiReferenceConfig.specs[0]

  if (!spec) {
    return null
  }

  // File sources are repository paths, not public routes, and remote sources
  // may disappear or reject browser traffic. Thally already serves the parsed
  // default spec at this stable route in both self-hosted and managed sites.
  return new URL('/openapi.yaml', siteUrl).toString()
}
