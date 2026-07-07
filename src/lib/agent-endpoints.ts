/**
 * Paths that are already terminal, machine-targeted endpoints and must be
 * served as-is — never rewritten to `/api/docs/{slug}` for agent requests.
 *
 * Without this guard, a bot User-Agent hitting `/ai.txt`, `/llms.txt`, or
 * `/api/docs-index` would be rewritten to `/api/docs/ai.txt` (etc.) and 404 —
 * which defeats the entire agent-discovery flow.
 */
export function isMachineEndpoint(pathname: string): boolean {
  if (pathname.startsWith('/api/')) return true
  // Everything under /.well-known/ is by definition a machine-targeted
  // document (RFC 8615) — many are extensionless (api-catalog,
  // oauth-protected-resource), so the extension check below can't catch them.
  if (pathname.startsWith('/.well-known/')) return true

  const exact = new Set<string>([
    '/llms.txt',
    '/llms-full.txt',
    '/ai.txt',
    '/skill.md',
    '/AGENTS.md',
    '/sitemap.xml',
    '/robots.txt',
    '/openapi.json',
    '/openapi.yaml',
    '/changelog/rss.xml',
    '/icon',
  ])
  if (exact.has(pathname)) return true

  // Static assets and other non-HTML resources (incl. .md mirrors) resolve
  // themselves — never rewrite them to /api/docs/{slug}.
  return /\.(xml|txt|json|ya?ml|rss|md|png|jpe?g|svg|webp|ico|gif|css|js|map)$/.test(pathname)
}

/**
 * Public agent-discovery and crawler-control documents that must stay
 * anonymously reachable even when docs-access protection is enabled.
 *
 * These are non-sensitive machine endpoints — crawler directives
 * (robots.txt, sitemap.xml), discovery indexes (llms.txt, llms-full.txt,
 * ai.txt), the OpenAPI description, the RSS changelog, the packaged agent
 * guides (skill.md, AGENTS.md, auth.md), and everything under /.well-known/
 * (MCP card, A2A agent card, Agent Skills, OAuth Protected Resource metadata,
 * api-catalog). Redirecting any of these to the HTML /access gate would hand an
 * MCP client or crawler a login page instead of the JSON/markdown it expects —
 * and would make auth.md and /.well-known/oauth-protected-resource (which both
 * promise anonymous read access) false.
 *
 * This is deliberately NARROWER than isMachineEndpoint: docs *content* machine
 * surfaces (/api/docs/*, /api/markdown/*, and .md page mirrors) are NOT public
 * here, so they stay behind the access gate along with the HTML pages.
 */
export function isPublicAgentEndpoint(pathname: string): boolean {
  // Every /.well-known/ document is a machine-targeted discovery resource
  // (RFC 8615) — many are extensionless, so enumerate the prefix.
  if (pathname.startsWith('/.well-known/')) return true

  const publicExact = new Set<string>([
    '/robots.txt',
    '/sitemap.xml',
    '/llms.txt',
    '/llms-full.txt',
    '/ai.txt',
    '/openapi.json',
    '/openapi.yaml',
    '/changelog/rss.xml',
    '/skill.md',
    '/AGENTS.md',
    '/auth.md',
  ])
  return publicExact.has(pathname)
}
