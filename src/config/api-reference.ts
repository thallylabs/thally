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
  const apiCollections = collections.filter((c) => c.api)

  if (apiCollections.length === 0) {
    return { defaultSpecId: 'default', specs: [] }
  }

  // A docs.json with several tabs each binding their own spec (e.g. a
  // migrated Fern site with a REST and a WebSocket API) gets one spec per
  // tab, routed at `/api/<specId>/...`. The first keeps the stable
  // `'default'` id existing single-spec sites already rely on; the rest are
  // keyed by their own tab's id, which is already unique per tab.
  return {
    defaultSpecId: 'default',
    specs: apiCollections.map((collection, index) =>
      buildSpecFromDocsJson(collection.api!, index === 0 ? 'default' : collection.id, index === 0 ? 'API Reference' : collection.label)),
  }
}

function buildSpecFromDocsJson(api: DocsJsonApiConfig, id: string, label: string): ApiSpecConfig {
  const isUrl = api.source.startsWith('http://') || api.source.startsWith('https://')
  return {
    id,
    label,
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
