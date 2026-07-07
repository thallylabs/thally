import { type NextRequest } from 'next/server'
import { getAllApiOperationNodes } from '@/data/api-reference'
import { getDocEntries, getSidebarCollections } from '@/data/docs'
import { getSiteUrl } from '@/lib/site-url'

const baseUrl = getSiteUrl()

export async function GET(_request: NextRequest) {
  const entries = getDocEntries()
  const collections = getSidebarCollections()
  const apiNodes = await getAllApiOperationNodes()

  // Build a lookup: href → { tab, group }
  const hrefToNav = new Map<string, { tab: string; group: string }>()
  for (const collection of collections) {
    for (const section of collection.sections) {
      for (const item of section.items) {
        const parts = section.title.split(' • ')
        hrefToNav.set(item.href, {
          tab: collection.label,
          group: parts[parts.length - 1] ?? section.title,
        })
      }
    }
  }

  const docPages = entries
    .filter((e) => !e.noindex && !e.hidden)
    .map((e) => {
      const nav = hrefToNav.get(e.href)
      return {
        type: 'doc' as const,
        id: e.id,
        title: e.title,
        description: e.description,
        url: `${baseUrl}${e.href}`,
        api_url: `${baseUrl}/api/docs/${e.id}`,
        json_ld_url: `${baseUrl}${e.href}?format=ldjson`,
        tab: nav?.tab ?? '',
        group: nav?.group ?? '',
        ...(e.badge ? { badge: e.badge } : {}),
        ...(e.keywords.length ? { keywords: e.keywords } : {}),
        ...(e.lastVerified ? { last_verified: e.lastVerified } : {}),
        ...(e.verifiedVersion ? { verified_version: e.verifiedVersion } : {}),
      }
    })

  const apiPages = apiNodes.map((node) => ({
    type: 'api_operation' as const,
    id: node.slug.join('/'),
    title: node.operation.title,
    description: node.operation.description ?? `${node.operation.method} ${node.operation.path}`,
    url: `${baseUrl}${node.href}`,
    method: node.operation.method,
    path: node.operation.path,
    openapi_url: `${baseUrl}/openapi.yaml`,
    ...(node.operation.tags?.length ? { tags: node.operation.tags } : {}),
  }))

  const pages = [...docPages, ...apiPages]

  return Response.json(
    {
      schema_version: '1',
      as_of: new Date().toISOString(),
      total: pages.length,
      discovery: {
        llms_txt: `${baseUrl}/llms.txt`,
        llms_full_txt: `${baseUrl}/llms-full.txt`,
        ai_txt: `${baseUrl}/ai.txt`,
        mcp: `${baseUrl}/api/mcp`,
        openapi: `${baseUrl}/openapi.yaml`,
      },
      pages,
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
      },
    },
  )
}
