/**
 * Normalizes docs.json API-reference settings for rendering and discovery.
 * Public links always target Thally's served projection, never source storage.
 */

import type { ApiReferenceConfig, ApiSpecConfig } from '@/lib/openapi/types'
import { getSidebarCollections, tabCollectionId } from '@/data/docs'
import type { DocsJsonApiConfig } from '@/data/docs'
import { getDocsJsonConfig } from '@/lib/docs-json-config'
import { getSiteUrl } from '@/lib/site-url'

/**
 * Specs bound to hidden tabs. They never show in navigation, but a page whose
 * `openapi:` frontmatter names one (Mintlify allows a spec referenced only
 * from page frontmatter) resolves against them. Hidden tabs already served as
 * a version's tabs are excluded: getSidebarCollections returns those.
 */
function hiddenApiCollections(visibleIds: Set<string>): Array<{ id: string; label: string; api: DocsJsonApiConfig; pageOnly?: boolean }> {
  const tabs = getDocsJsonConfig<{ tabs?: Array<{ tab: string; displayLabel?: string; hidden?: boolean; api?: DocsJsonApiConfig }> }>().tabs ?? []
  return tabs.flatMap((tab) => {
    const id = tabCollectionId(tab.tab)
    return tab.hidden && tab.api && !visibleIds.has(id) ? [{ id, label: tab.displayLabel ?? tab.tab, api: tab.api, pageOnly: true }] : []
  })
}

function buildApiReferenceConfig(): ApiReferenceConfig {
  const collections = getSidebarCollections()
  const visibleApi = collections.filter((c) => c.api)
  // Hidden-tab specs come after every visible one, so the visible first spec stays `default`.
  const apiCollections = [...visibleApi, ...hiddenApiCollections(new Set(collections.map((c) => c.id)))]

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
      buildSpecFromDocsJson(collection.api!, index === 0 ? 'default' : collection.id, index === 0 ? 'API Reference' : collection.label, 'pageOnly' in collection)),
  }
}

function buildSpecFromDocsJson(api: DocsJsonApiConfig, id: string, label: string, pageOnly = false): ApiSpecConfig {
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
    ...(pageOnly ? { pageOnly: true } : {}),
  }
}

export const apiReferenceConfig: ApiReferenceConfig = buildApiReferenceConfig()

/**
 * Return the canonical public YAML projection for the configured specification.
 * Only the default spec is published (`/openapi.yaml`), so a `specId` naming any
 * other spec has no URL rather than borrowing the default's.
 */
export function getOpenApiSpecUrl(siteUrl = getSiteUrl(), specId?: string): string | null {
  const spec = apiReferenceConfig.specs.find((entry) => entry.id === apiReferenceConfig.defaultSpecId)
    ?? apiReferenceConfig.specs[0]

  if (!spec || (specId !== undefined && specId !== spec.id)) {
    return null
  }

  // File sources are repository paths, not public routes, and remote sources
  // may disappear or reject browser traffic. Thally already serves the parsed
  // default spec at this stable route in both self-hosted and managed sites.
  return new URL('/openapi.yaml', siteUrl).toString()
}
