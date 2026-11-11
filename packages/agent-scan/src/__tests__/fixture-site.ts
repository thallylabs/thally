/**
 * A synthetic documentation site served through the fake transport. Every
 * check passes on the default site; options switch individual signals off.
 */

import { docPage, html, notFound, text, type FakeRoute, type FakeRoutes } from './helpers.js'

/** Switches for the synthetic site. */
export interface FixtureSiteOptions {
  origin?: string
  pageCount?: number
  robots?: string | FakeRoute
  llms?: boolean
  llmsFull?: boolean
  sitemap?: boolean
  manifest?: boolean
  markdown?: boolean
}

/** Page paths in the fixture sitemap, unsorted on purpose. */
export function fixturePaths(count: number): string[] {
  const paths: string[] = []
  for (let i = count - 1; i >= 0; i--) paths.push(`/guide/page-${String(i).padStart(2, '0')}`)
  return paths
}

/** Routes for the synthetic site. */
export function fixtureSite(options: FixtureSiteOptions = {}): FakeRoutes {
  const origin = options.origin ?? 'https://docs.example.com'
  const paths = fixturePaths(options.pageCount ?? 25)
  const routes: FakeRoutes = {}
  routes[`${origin}/robots.txt`] = typeof options.robots === 'object'
    ? options.robots
    : text(options.robots ?? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`)
  routes[`${origin}/`] = html(docPage({
    url: `${origin}/`,
    title: 'Home',
    links: paths.slice(0, 3).map((path) => `${origin}${path}`),
    head: '<meta name="generator" content="Docusaurus v3.5.2">',
  }))
  routes[`${origin}/llms.txt`] = options.llms === false
    ? notFound
    : text(`# Example Docs\n\n> Example.\n\n- [MCP](https://mcp.example.com/sse)\n`)
  routes[`${origin}/llms-full.txt`] = options.llmsFull === false ? notFound : text(`# Example Docs\n\n${'Full text. '.repeat(400)}`)
  routes[`${origin}/sitemap.xml`] = options.sitemap === false
    ? notFound
    : { status: 200, headers: { 'content-type': 'application/xml' }, body: `<?xml version="1.0"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...paths, '/'].map((path) => `<url><loc>${origin}${path}</loc></url>`).join('')}</urlset>` }
  routes[`${origin}/.well-known/mcp.json`] = options.manifest === false
    ? notFound
    : { status: 200, headers: { 'content-type': 'application/json' }, body: '{"name":"example","url":"https://mcp.example.com/sse"}' }
  routes[`${origin}/.well-known/mcp/server-card.json`] = notFound
  routes[`${origin}/.well-known/agent-card.json`] = notFound
  for (const path of paths) {
    const title = `Page ${path.slice(-2)}`
    routes[`${origin}${path}`] = html(docPage({ url: `${origin}${path}`, title }))
    routes[`${origin}${path}.md`] = options.markdown === false
      ? notFound
      : text(`---\ntitle: ${title}\n---\n\n# ${title}\n\nBody.\n`, 'text/markdown')
    routes[`${origin}${path} text/markdown`] = html(docPage({ url: `${origin}${path}`, title }))
    routes[`${origin}${path}?format=json`] = notFound
  }
  return routes
}
