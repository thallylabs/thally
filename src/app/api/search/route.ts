import { type NextRequest } from 'next/server'
import { searchDocs, type SearchMode } from '@/lib/search/engine'
import { recordAnalyticsEvent } from '@/lib/cloud-bridge'
import { classifyRequest } from '@/lib/traffic-classifier'
import { problemResponse } from '@/lib/http/problem'
import { getEffectiveI18nConfig } from '@/lib/i18n/request'
import { consumePublicQuota, readRateLimitEnv } from '@/lib/http/public-rate-limit'
import { getEmbeddingProvider, localHashProvider } from '@thallylabs/core/embeddings'

export const runtime = 'nodejs'

/**
 * Hybrid queries per client per minute when a hosted embedding provider is
 * configured (each one is a billed embedding call). 0 disables the limit.
 */
const HYBRID_RATE_PER_MIN = readRateLimitEnv('SEARCH_HYBRID_RATE_PER_MIN', 20)

/**
 * Pick the search mode. Full-text is the default: anonymous callers must opt
 * into `mode=hybrid`, because with a hosted embedding provider every hybrid
 * query is an outbound, billed embedding request. Opted-in hybrid queries are
 * metered per client (non-spoofable key, see `public-rate-limit`); over the
 * limit — or when the limiter cannot be consulted — the query degrades to
 * full-text instead of failing. The local embedder costs nothing, so it is
 * never metered.
 */
async function resolveSearchMode(request: NextRequest): Promise<{ mode: SearchMode; isDegraded: boolean }> {
  if (request.nextUrl.searchParams.get('mode') !== 'hybrid') return { mode: 'fulltext', isDegraded: false }
  if (getEmbeddingProvider().id === localHashProvider.id) return { mode: 'hybrid', isDegraded: false }
  const { allowed } = await consumePublicQuota({
    bucket: 'search_hybrid_rate',
    headers: request.headers,
    limitPerMinute: HYBRID_RATE_PER_MIN,
    failOpen: false,
  })
  return allowed ? { mode: 'hybrid', isDegraded: false } : { mode: 'fulltext', isDegraded: true }
}

export async function GET(request: NextRequest) {
  const baseUrl = request.nextUrl.origin
  const params = request.nextUrl.searchParams
  const query = params.get('q')?.trim() ?? ''
  const limit = Math.min(Math.max(Number(params.get('limit') ?? 8), 1), 25)

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

  const { mode, isDegraded } = await resolveSearchMode(request)
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
      ...(isDegraded ? { mode_requested: 'hybrid', mode_degraded_reason: 'rate_limited' } : {}),
      total: hits.length,
      as_of: new Date().toISOString(),
      results: hits.map((hit) => ({
        type: hit.type,
        page_id: hit.pageId,
        title: hit.title,
        description: hit.description,
        url: `${baseUrl}${hit.href}`,
        ...(hit.anchor ? { section_url: `${baseUrl}${hit.href}#${hit.anchor}`, heading: hit.heading } : {}),
        // Generated API operations have no `/api/docs` page projection; their
        // structured form is MCP `get_api_operation`.
        ...(hit.type === 'page' ? { api_url: `${baseUrl}/api/docs/${locale ? `${locale}/` : ''}${hit.pageId}` } : {}),
        ...(hit.method ? { method: hit.method, path: hit.path } : {}),
        score: hit.score,
        snippet: hit.snippet,
      })),
    },
    {
      headers: {
        // A degraded answer must not be cached under the hybrid URL.
        'Cache-Control': isDegraded ? 'no-store' : 'public, s-maxage=300, stale-while-revalidate=3600',
        Vary: 'Accept',
      },
    },
  )
}
