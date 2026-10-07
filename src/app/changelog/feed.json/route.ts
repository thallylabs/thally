import { loadChangelog } from '@/lib/changelog'
import { renderChangelogJsonFeed } from '@/lib/changelog-feeds'
import { resolveSiteConfig } from '@/lib/site-config'

/**
 * JSON Feed 1.1 of the site's changelog — the same entries as
 * `/changelog/rss.xml`, in a form agents can parse without XML. 404 when the
 * site has no changelog page.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  const [changelog, site] = await Promise.all([loadChangelog({ origin }), resolveSiteConfig(origin)])
  if (!changelog.pageUrl) return new Response('Not Found', { status: 404 })
  return Response.json(renderChangelogJsonFeed(changelog, { name: site.name, origin }), {
    headers: {
      'Content-Type': 'application/feed+json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
