import { buildSkillManifest } from '@/lib/agent-manifest'
import { resolveRequestSiteConfig, siteIdentity } from '@/lib/site-config'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const identity = siteIdentity(await resolveRequestSiteConfig())
  return new Response(buildSkillManifest(identity, new URL(request.url).origin), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
