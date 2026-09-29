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
 * These are non-sensitive machine endpoints: crawler directives, capability
 * hints, authentication guidance, and RFC 8615 connection metadata. Corpus,
 * schemas, sitemaps, changelogs, and author-owned agent instructions are
 * intentionally excluded because they can disclose protected content.
 *
 * This is deliberately narrower than isMachineEndpoint: docs-content machine
 * surfaces stay behind the access gate along with the HTML pages.
 */
export function isPublicAgentEndpoint(pathname: string): boolean {
  // Most /.well-known/ documents describe how to authenticate or connect and
  // must remain reachable before authentication. The llms projection is the
  // exception: despite its discovery-shaped URL, it contains the docs corpus.
  if (pathname.startsWith('/.well-known/') && pathname !== '/.well-known/llms.txt') {
    return true
  }

  const publicExact = new Set<string>([
    '/robots.txt',
    '/ai.txt',
    '/skill.md',
    '/auth.md',
  ])
  return publicExact.has(pathname)
}

/**
 * Machine-readable surfaces that disclose authored documentation content.
 *
 * These paths remain public on public sites, but follow the same docs-access
 * policy as HTML pages on password-protected sites. Keep this list explicit:
 * discovery metadata needed to learn the authentication contract belongs in
 * {@link isPublicAgentEndpoint}, never here.
 */
export function isContentBearingAgentEndpoint(pathname: string): boolean {
  if (
    pathname === '/api/docs-index' ||
    pathname === '/api/agent-readiness' ||
    pathname === '/api/mcp' ||
    pathname === '/api/search' ||
    pathname.startsWith('/api/docs/') ||
    pathname.startsWith('/api/markdown/')
  ) {
    return true
  }

  if (pathname.endsWith('.md') && !isPublicAgentEndpoint(pathname)) return true

  return new Set<string>([
    '/llms.txt',
    '/llms-full.txt',
    '/.well-known/llms.txt',
    '/AGENTS.md',
    '/sitemap.xml',
    '/openapi.json',
    '/openapi.yaml',
    '/changelog/rss.xml',
  ]).has(pathname)
}

/** Classify discovery-shaped traffic without granting anonymous access. */
export function isAgentDiscoveryEndpoint(pathname: string): boolean {
  return (
    isPublicAgentEndpoint(pathname) ||
    new Set<string>([
      '/llms.txt',
      '/llms-full.txt',
      '/.well-known/llms.txt',
      '/AGENTS.md',
      '/sitemap.xml',
      '/openapi.json',
      '/openapi.yaml',
      '/changelog/rss.xml',
      '/api/docs-index',
    ]).has(pathname)
  )
}
