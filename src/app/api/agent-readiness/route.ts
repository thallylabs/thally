import { computeAgentReadiness } from '@/lib/agent-readiness'

export const runtime = 'nodejs'

export async function GET() {
  const report = computeAgentReadiness()

  return Response.json(
    {
      schema_version: '1',
      as_of: new Date().toISOString(),
      ...report,
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
      },
    },
  )
}
