import { buildSkillManifest } from '@/lib/agent-manifest'

export const runtime = 'nodejs'

export function GET() {
  return new Response(buildSkillManifest(), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
