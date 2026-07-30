import { buildAiTxtBody } from '@/lib/agent-discovery'
import { resolveRequestSiteConfig, siteIdentity } from '@/lib/site-config'

export async function GET(request: Request) {
  const identity = siteIdentity(await resolveRequestSiteConfig())
  return new Response(buildAiTxtBody(identity, new URL(request.url).origin), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
