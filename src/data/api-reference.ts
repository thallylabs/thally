import { cache } from 'react'
import { apiReferenceConfig } from '@/config/api-reference'
import { getSpecConfig, loadSpec } from '@/lib/openapi/fetch'
import { buildOperationKey, normalizeSpec } from '@/lib/openapi/normalize'
import type { NormalizedOperation, NormalizedSpec } from '@/lib/openapi/types'

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

