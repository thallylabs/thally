import { buildAiTxtBody } from '@/lib/agent-discovery'
import { resolveRequestSiteConfig, siteIdentity } from '@/lib/site-config'
import { getEffectiveI18nConfig } from '@/lib/i18n/request'

export async function GET(request: Request) {
  const identity = siteIdentity(await resolveRequestSiteConfig())
  return new Response(buildAiTxtBody(identity, new URL(request.url).origin, await getEffectiveI18nConfig()), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
