import { type NextRequest } from 'next/server'
import { searchDocs, type SearchMode } from '@/lib/search/engine'
import { recordAnalyticsEvent } from '@/lib/cloud-bridge'
import { classifyRequest } from '@/lib/traffic-classifier'
import { problemResponse } from '@/lib/http/problem'
import { getEffectiveI18nConfig } from '@/lib/i18n/request'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const baseUrl = request.nextUrl.origin
  const params = request.nextUrl.searchParams
  const query = params.get('q')?.trim() ?? ''
  const limit = Math.min(Math.max(Number(params.get('limit') ?? 8), 1), 25)
  const mode: SearchMode = params.get('mode') === 'fulltext' ? 'fulltext' : 'hybrid'

  if (!query) {
    return problemResponse({
      status: 400,
      code: 'missing_query',
      title: 'Search query required',
      detail: 'The `q` query parameter is required.',
      resolution: 'Retry with a non-empty query, for example `/api/search?q=authentication`.',
      instance: request.nextUrl.pathname,
    })
  }

  const requestedLocale = params.get('locale')
  const i18n = await getEffectiveI18nConfig()
  if (requestedLocale && !i18n.locales.some((locale) => locale.code === requestedLocale)) {
    return problemResponse({
      status: 400,
      code: 'invalid_locale',
      title: 'Unsupported language',
      detail: 'The requested locale is not enabled for this site.',
      resolution: 'Use a language code enabled in the site configuration.',
      instance: request.nextUrl.pathname,
    })
  }
  const locale = requestedLocale && requestedLocale !== i18n.defaultLocale
    ? requestedLocale
    : undefined

  const hits = await searchDocs(query, { limit, mode, locale })

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
      locale: requestedLocale ?? i18n.defaultLocale,
      mode,
      total: hits.length,
      as_of: new Date().toISOString(),
      results: hits.map((hit) => ({
        page_id: hit.pageId,
        title: hit.title,
        description: hit.description,
        url: `${baseUrl}${hit.href}`,
        api_url: `${baseUrl}/api/docs/${locale ? `${locale}/` : ''}${hit.pageId}`,
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
