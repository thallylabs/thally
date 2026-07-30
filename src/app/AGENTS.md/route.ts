import { buildAgentsManifest } from '@/lib/agent-manifest'
import { readRuntimeSource, runtimeSourceExists } from '@/lib/runtime-sources'
import { resolveRequestSiteConfig, siteIdentity } from '@/lib/site-config'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  // Author override: a physical AGENTS.md at the project root wins over the
  // generated default, so teams can hand-tune agent guidance. Production
  // reads the same source from the build-generated Worker manifest.
  if (runtimeSourceExists('AGENTS.md')) {
    return new Response(readRuntimeSource('AGENTS.md'), {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    })
  }

  const identity = siteIdentity(await resolveRequestSiteConfig())
  return new Response(buildAgentsManifest(identity, new URL(request.url).origin), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
