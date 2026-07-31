import { buildAgentsManifest } from '@/lib/agent-manifest'
import { getContentSource } from '@/lib/content-source'
import { resolveRequestSiteConfig, siteIdentity } from '@/lib/site-config'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  // Author overrides follow the active source so an assets-mode replacement
  // never falls back to the baseline Worker's physical AGENTS.md. Filesystem
  // mode remains the active source for OSS and preserves repository overrides.
  const override = await getContentSource().read('AGENTS.md')
  if (override) {
    return new Response(override.content, {
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
