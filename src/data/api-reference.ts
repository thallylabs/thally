import { cache } from 'react'
import { apiReferenceConfig } from '@/config/api-reference'
import { getSpecConfig, loadSpec } from '@/lib/openapi/fetch'
import { buildOperationKey, normalizeSpec } from '@/lib/openapi/normalize'
import type { NavigationSection, SidebarCollection } from '@/data/docs'
import type { NormalizedOperation, NormalizedSpec } from '@/lib/openapi/types'
import { findSpecForRef, type OpenApiFrontmatterRef } from '@/lib/openapi/page-frontmatter'

export interface ApiNavigationItem {
  id: string
  title: string
  href: string
  slug: Array<string>
  method: string
  path: string
  badge?: string
}

export interface ApiNavigationGroup {
  title: string
  items: Array<ApiNavigationItem>
}

export interface ApiOperationNode {
  operation: NormalizedOperation
  slug: Array<string>
  href: string
}

function resolveSpecId(specId?: string) {
  if (!specId) {
    return apiReferenceConfig.defaultSpecId
  }
  return apiReferenceConfig.specs.some((spec) => spec.id === specId) ? specId : apiReferenceConfig.defaultSpecId
}

const getNormalizedSpec = cache(async (specId?: string): Promise<NormalizedSpec> => {
  if (apiReferenceConfig.specs.length === 0) return { operations: [], config: {} as NormalizedSpec['config'], servers: [] }
  const resolvedSpecId = resolveSpecId(specId)
  const config = getSpecConfig(apiReferenceConfig, resolvedSpecId)
  const resolved = await loadSpec(config)
  return normalizeSpec(resolved)
})

export const getApiOperationNodes = cache(async (specId?: string): Promise<Array<ApiOperationNode>> => {
  const spec = await getNormalizedSpec(specId)
  return spec.operations
    .filter((operation) => !operation.hidden)
    .map((operation) => {
      const slug = [operation.specId, ...(operation.slug ?? [])]
      return {
        operation,
        slug,
        href: `/api/${slug.join('/')}`,
      }
    })
})

export const getAllApiOperationNodes = cache(async (): Promise<Array<ApiOperationNode>> => {
  const nodesPerSpec = await Promise.all(apiReferenceConfig.specs.map((spec) => getApiOperationNodes(spec.id)))
  return nodesPerSpec.flat()
})

export async function getApiOperationBySlug(slugSegments?: Array<string>): Promise<ApiOperationNode | null> {
  if (!slugSegments?.length) {
    return null
  }

  const [maybeSpecId, ...rest] = slugSegments
  const specExists = apiReferenceConfig.specs.some((spec) => spec.id === maybeSpecId)

  const specId = specExists ? maybeSpecId : apiReferenceConfig.defaultSpecId
  const operationSlug = specExists ? rest : slugSegments

  const nodes = await getApiOperationNodes(specId)
  const targetSlug = operationSlug.join('/')

  return nodes.find((node) => node.slug.slice(1).join('/') === targetSlug) ?? null
}

export async function getApiOperationByKey(
  method: string,
  path: string,
  specId?: string,
): Promise<ApiOperationNode | null> {
  if (!method || !path) {
    return null
  }

  const normalizedMethod = method.toUpperCase()
  const key = buildOperationKey(normalizedMethod, path)

  if (specId) {
    const nodes = await getApiOperationNodes(specId)
    return nodes.find((node) => node.operation.key === key) ?? null
  }

  const allNodes = await getAllApiOperationNodes()
  return allNodes.find((node) => node.operation.key === key) ?? null
}

export async function getApiWebhookByName(name: string, specId?: string): Promise<ApiOperationNode | null> {
  if (!name) return null
  const nodes = specId ? await getApiOperationNodes(specId) : await getAllApiOperationNodes()
  return nodes.find((node) => node.operation.isWebhook && node.operation.path === name) ?? null
}

/**
 * Resolve a page's `openapi:` frontmatter. A spec prefix selects that spec
 * (unknown spec: no match). Without one the default spec is tried first, so
 * existing pages resolve exactly as before, then the remaining specs in
 * configured order; a repeat match there resolves to the first with a warning.
 */
export async function getApiOperationForFrontmatter(ref: OpenApiFrontmatterRef): Promise<ApiOperationNode | null> {
  const lookup = (specId: string) => ref.webhook
    ? getApiWebhookByName(ref.path, specId)
    : getApiOperationByKey(ref.method, ref.path, specId)
  if (ref.specRef) {
    const spec = findSpecForRef(apiReferenceConfig.specs, ref.specRef)
    return spec ? lookup(spec.id) : null
  }
  const inDefault = await lookup(ref.specId)
  if (inDefault) return inDefault
  const matches: Array<ApiOperationNode> = []
  for (const spec of apiReferenceConfig.specs) {
    if (spec.id === ref.specId) continue
    try {
      const node = await lookup(spec.id)
      if (node) matches.push(node)
    } catch {
      // A broken secondary spec must not take down a page that never named it.
    }
  }
  if (matches.length > 1) {
    console.warn(`[thally] openapi frontmatter "${ref.method} ${ref.path}" matches ${matches.length} specs; using the first. Prefix the spec file to disambiguate.`)
  }
  return matches[0] ?? null
}

/**
 * The public path serving the spec a page's `openapi:` resolves to, or
 * undefined. Only the default spec is published (`/openapi.yaml`, sanitised);
 * other local specs and remote URLs have no public route, and a remote URL is
 * never echoed since it may be private. Unresolvable or hidden operations
 * have none either.
 */
export async function servedSpecPathForFrontmatter(ref: OpenApiFrontmatterRef): Promise<string | undefined> {
  try {
    const node = await getApiOperationForFrontmatter(ref)
    return node?.operation.specId === apiReferenceConfig.defaultSpecId ? '/openapi.yaml' : undefined
  } catch {
    return undefined
  }
}

export async function buildApiNavigation(specId?: string): Promise<Array<ApiNavigationGroup>> {
  if (apiReferenceConfig.specs.length === 0) return []
  const spec = await getNormalizedSpec(specId)
  const nodes = await getApiOperationNodes(spec.config.id)
  const groupMap = new Map<string, Array<ApiNavigationItem>>()

  nodes.forEach((node) => {
    const title = node.operation.group
    const items = groupMap.get(title) ?? []
    items.push({
      id: node.operation.id,
      title: node.operation.title,
      href: node.href,
      slug: node.slug,
      method: node.operation.method,
      path: node.operation.path,
      badge: node.operation.badge,
    })
    groupMap.set(title, items)
  })

  const groups = Array.from(groupMap.entries()).map<ApiNavigationGroup>(([title, items]) => ({
    title,
    items: items.sort((a, b) => a.title.localeCompare(b.title)),
  }))

  return sortNavigationGroups(groups, spec)
}

/**
 * Append generated endpoint sections to every API collection. Each collection
 * lists the operations of its own spec (the first API tab is the `default`
 * spec, later ones are keyed by collection id), so several API tabs never show
 * one another's endpoints.
 */
export async function withApiNavigation(
  collections: Array<SidebarCollection>,
  hrefPrefix = '',
): Promise<Array<SidebarCollection>> {
  return Promise.all(
    collections.map(async (collection) => {
      if (!collection.api || collection.api.navigation === false) return collection
      const groups = await buildApiNavigation(collection.id)
      const apiSections: Array<NavigationSection> = groups.map((group, index) => ({
        id: `openapi-${index}`,
        title: group.title,
        items: group.items.map((item) => ({
          id: item.id,
          title: item.title,
          href: `${hrefPrefix}${item.href}`,
          badge: item.badge,
          description: `${item.method} ${item.path}`,
        })),
      }))
      return { ...collection, sections: [...(collection.sections ?? []), ...apiSections] }
    }),
  )
}

export async function getApiOperationSearchIndex() {
  const nodes = await getAllApiOperationNodes()
  return nodes.map((node) => ({
    id: node.operation.id,
    title: node.operation.title,
    description: node.operation.description ?? `${node.operation.method} ${node.operation.path}`,
    href: node.href,
    keywords: node.operation.tags,
  }))
}

function sortNavigationGroups(groups: Array<ApiNavigationGroup>, spec: NormalizedSpec) {
  const order = spec.config.tagsOrder?.map((tag) => tag.toLowerCase()) ?? []
  const webhookGroup = spec.config.webhookGroup

  const weight = (title: string) => {
    const normalized = title.toLowerCase()
    const index = order.indexOf(normalized)
    if (index >= 0) {
      return index
    }
    if (webhookGroup && title === webhookGroup) {
      return order.length + 0.5
    }
    return order.length + 1
  }

  return groups.sort((a, b) => {
    const diff = weight(a.title) - weight(b.title)
    if (diff !== 0) {
      return diff
    }
    return a.title.localeCompare(b.title)
  })
}

