import { type NextRequest } from 'next/server'
import { searchDocs, type SearchMode } from '@/lib/search/engine'
import { getSiteUrl } from '@/lib/site-url'
import { recordAnalyticsEvent } from '@/lib/cloud-bridge'
import { classifyRequest } from '@/lib/traffic-classifier'

export const runtime = 'nodejs'

const baseUrl = getSiteUrl()

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const query = params.get('q')?.trim() ?? ''
  const limit = Math.min(Math.max(Number(params.get('limit') ?? 8), 1), 25)
  const mode: SearchMode = params.get('mode') === 'fulltext' ? 'fulltext' : 'hybrid'

  if (!query) {
    return Response.json(
      { error: 'missing_query', message: 'Provide a query via the `q` parameter.' },
      { status: 400 },
    )
  }

  const hits = await searchDocs(query, { limit, mode })

  // Record the search (best-effort) — feeds the admin Search analytics.
  try {
    const classification = classifyRequest(request, '/api/search')
    await recordAnalyticsEvent({
      type: 'search_query',
      path: '/api/search',
      query,
      resultCount: hits.length,
      visitorType: classification.visitorType,
      agentSignal: classification.agentSignal,
    })
  } catch {
    // never fail the search on an analytics hiccup
  }

  return Response.json(
    {
      schema_version: '1',
      query,
      mode,
      total: hits.length,
      as_of: new Date().toISOString(),
      results: hits.map((hit) => ({
        page_id: hit.pageId,
        title: hit.title,
        description: hit.description,
        url: `${baseUrl}${hit.href}`,
        api_url: `${baseUrl}/api/docs/${hit.pageId}`,
        score: hit.score,
        snippet: hit.snippet,
      })),
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
        Vary: 'Accept',
      },
    },
  )
}
