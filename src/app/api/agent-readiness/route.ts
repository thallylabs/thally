/**
 * Public readiness report computed from the content this deployment serves.
 *
 * The route is unauthenticated and the report reads every page, so work is
 * bounded twice: a per-process memo shares one computation per cache window,
 * and any query string is redirected to the bare path so arbitrary parameters
 * cannot create new shared-cache keys that bypass `s-maxage`.
 */

import { getCachedPublishedAgentReadiness } from '@/lib/agent-readiness'

export const runtime = 'nodejs'

const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=3600'
const CANONICAL_PATH = '/api/agent-readiness'

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.search) {
    // The report takes no parameters. A fixed relative Location keeps the
    // redirect on the request's host and never reflects request input.
    return new Response(null, {
      status: 308,
      headers: { Location: CANONICAL_PATH, 'Cache-Control': CACHE_CONTROL },
    })
  }

  const { report, asOf } = await getCachedPublishedAgentReadiness()

  return Response.json(
    {
      // v1 consumers read the same top-level fields; `version` and the
      // per-check `status`, `fixHint`, and `affectedCount` are additive.
      schema_version: '2',
      as_of: asOf,
      ...report,
    },
    { headers: { 'Cache-Control': CACHE_CONTROL } },
  )
}
