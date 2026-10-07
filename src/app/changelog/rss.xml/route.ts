import { loadChangelog } from '@/lib/changelog'
import { renderChangelogRss } from '@/lib/changelog-feeds'
import { resolveSiteConfig } from '@/lib/site-config'

/**
 * RSS 2.0 feed of the site's changelog, derived from the `<Update>` entries on
 * the changelog page (see `@/lib/changelog`). 404 when the site has no
 * changelog page, so discovery never advertises an empty feed.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  const [changelog, site] = await Promise.all([loadChangelog({ origin }), resolveSiteConfig(origin)])
  if (!changelog.pageUrl) return new Response('Not Found', { status: 404 })
  return new Response(renderChangelogRss(changelog, { name: site.name, origin }), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
