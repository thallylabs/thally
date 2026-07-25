import { NextResponse } from 'next/server'
import type { NextFetchEvent, NextRequest } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  DOCS_ACCESS_COOKIE,
  getInternalAnalyticsSecretEdge,
  isAdminAuthenticatedEdge,
  isAdminEnabledEdge,
  isDocsAccessEnabledEdge,
  isDocsAccessGrantedEdge,
} from '@/lib/admin/auth-edge'
import { classifyRequest, isAgentRequest } from '@/lib/traffic-classifier'
import { isMachineEndpoint, isPublicAgentEndpoint } from '@/lib/agent-endpoints'
import { verifySession, SESSION_COOKIE } from '@/lib/auth/session'
import { getCloudAccessConfigEdge, getManagedSiteIdEdge } from '@/lib/cloud-link/edge'

function shouldTrackPath(pathname: string): boolean {
  // Admin console (pages + its own asset/nav requests) and Next internals are
  // never docs traffic.
  if (pathname.startsWith('/admin') || pathname.startsWith('/_next')) {
    return false
  }
  // Access gate, the generated icon, and static image assets.
  if (
    pathname === '/access' ||
    pathname === '/icon' ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.webp')
  ) {
    return false
  }
  // For API routes, only agent fetches of DOC CONTENT count as api_fetch
  // traffic. Everything else under /api is infrastructure — brand assets
  // (brand.css/logo/favicon), site-config, chat-status, OG images, admin,
  // analytics — or an endpoint that already records its own event (search →
  // search_query, feedback → feedback, chat → chat_message). Counting those
  // as page/api "views" inflated human traffic on every single page load.
  if (pathname.startsWith('/api/')) {
    return pathname.startsWith('/api/docs') || pathname.startsWith('/api/markdown')
  }
  return true
}

// A prefetch/prerender is speculative — the browser fetches a link the user may
// never visit, so counting it as a view inflates traffic. We match the standard
// `Sec-Purpose`/`Purpose` request headers. (Next.js <Link> prefetches send
// `Next-Router-Prefetch`, but the framework strips that header before middleware
// can read it — verified — so those can't be caught here. Admin-page prefetches
// are instead excluded by isFromAdmin via the referer.)
function isPrefetchRequest(request: NextRequest): boolean {
  const secPurpose = request.headers.get('sec-purpose') ?? ''
  if (secPurpose.includes('prefetch') || secPurpose.includes('prerender')) return true
  const purpose = (request.headers.get('purpose') ?? request.headers.get('x-purpose') ?? '').toLowerCase()
  return purpose === 'prefetch'
}

// Requests kicked off by the admin dashboard (its own data fetches to public
// endpoints, its link prefetches) carry an /admin referer. That's the owner
// operating the console, not docs traffic — don't count it.
function isFromAdmin(request: NextRequest): boolean {
  const referer = request.headers.get('referer')
  if (!referer) return false
  try {
    const path = new URL(referer).pathname
    return path === '/admin' || path.startsWith('/admin/')
  } catch {
    return false
  }
}

function shouldTrackRequest(request: NextRequest, pathname: string): boolean {
  return shouldTrackPath(pathname) && !isPrefetchRequest(request) && !isFromAdmin(request)
}

function buildAnalyticsPayload(request: NextRequest, pathname: string) {
  const classification = classifyRequest(request, pathname)
  const slugPath = pathname === '/' ? 'introduction' : pathname.slice(1).replace(/\.md$/, '')

  // Crawler-control + agent-discovery machine documents (robots.txt, sitemap,
  // llms.txt/ai.txt, OpenAPI, RSS, skill.md/AGENTS.md/auth.md, everything under
  // /.well-known/) are 'discovery' — not docs page views. Without this,
  // /.well-known/mcp.json and /auth.md were recorded as 'page_view' with bogus
  // slugs like '.well-known/mcp.json' and 'auth', masquerading as docs pages.
  const isDiscovery = isPublicAgentEndpoint(pathname) || pathname === '/api/docs-index'

  return {
    type: isDiscovery ? 'discovery' : pathname.startsWith('/api/') ? 'api_fetch' : 'page_view',
    path: pathname,
    // Discovery endpoints are not docs pages, so they never get a page slug.
    slug: isDiscovery ? undefined : slugPath || undefined,
    visitorType: classification.visitorType,
    agentSignal: classification.agentSignal,
    format: classification.format,
    referer: request.headers.get('referer') ?? undefined,
  }
}

async function sendAnalyticsEvent(request: NextRequest, pathname: string) {
  if (!shouldTrackRequest(request, pathname)) return

  const origin = request.nextUrl.origin
  const secret = getInternalAnalyticsSecretEdge()

  await fetch(`${origin}/api/analytics/collect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-thally-analytics-secret': secret,
    },
    body: JSON.stringify(buildAnalyticsPayload(request, pathname)),
  }).catch(() => {
    // analytics must never block requests
  })
}

// API routes whose responses are pure projections of published content, so a
// content publish (which purges by tag) must be able to evict them.
const CONTENT_PROJECTION_API_PREFIXES = ['/api/docs/', '/api/markdown/']
const CONTENT_PROJECTION_API_PATHS = ['/api/docs-index', '/api/og']

function isManagedContentCachePath(pathname: string): boolean {
  if (pathname.startsWith('/api/')) {
    return (
      CONTENT_PROJECTION_API_PATHS.includes(pathname) ||
      CONTENT_PROJECTION_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    )
  }
  // Everything else that reaches this check is a content surface: doc pages,
  // their .md mirrors, llms.txt / llms-full.txt, sitemap, robots.
  return !pathname.startsWith('/admin') && !pathname.startsWith('/_next') && pathname !== '/access'
}

/**
 * Under the assets ContentSource, doc responses are served from the CDN and
 * invalidated by tag when a content publish lands: `Cache-Tag: site:{siteId}`
 * is the purge handle, and the long CDN TTL makes the tag the only eviction
 * path. Applied in middleware because App Router pages cannot set response
 * headers themselves.
 *
 * The env var is read inline (not via @/lib/content-source) because that
 * module's filesystem provider imports node:fs, which cannot be bundled into
 * edge middleware.
 *
 * `isAffirmativelyPublic` must fail CLOSED: headers are applied only when the
 * managed access config was actually read and says the site is public. When
 * the config is unavailable (control-plane outage), request gating above
 * fails open for availability, but a possibly-password-gated page must never
 * be frozen into a shared cache for a year.
 *
 * `cdnCacheable: false` sets the purge tag without a TTL. Used for the
 * agent content-negotiation rewrite: it varies on User-Agent/Accept while
 * sharing the browser URL's cache key (CDNs do not honor Vary on those), so
 * a cached agent response would poison the URL for human visitors. Agents
 * that want cached responses have URL-distinct forms (`.md`, `?format=`).
 */
function applyManagedContentCacheHeaders(
  response: NextResponse,
  pathname: string,
  isAffirmativelyPublic: boolean,
  options: { cdnCacheable: boolean } = { cdnCacheable: true },
): NextResponse {
  if (process.env.THALLY_CONTENT_SOURCE?.trim().toLowerCase() !== 'assets') return response
  if (!isAffirmativelyPublic) return response
  if (!isManagedContentCachePath(pathname)) return response
  const siteId = getManagedSiteIdEdge()
  if (!siteId) return response
  response.headers.set('Cache-Tag', `site:${siteId}`)
  if (options.cdnCacheable) {
    response.headers.set('CDN-Cache-Control', 'public, s-maxage=31536000')
  }
  return response
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl
  const cloudAccess = await getCloudAccessConfigEdge(request.nextUrl.origin)
  const docsAccessEnabled =
    isDocsAccessEnabledEdge() || cloudAccess?.access?.mode === 'password'

  // Affirmative check for CDN cacheability: the access config must be present
  // AND public. `cloudAccess == null` (self-host, or a failed/timed-out grant
  // exchange) means "unknown", and unknown never enters a shared cache.
  const contentCachePublic = !isDocsAccessEnabledEdge() && cloudAccess?.access?.mode === 'public'

  // Gate admin PAGES and admin APIs at the edge — except the public auth routes
  // (login/OIDC start/callback), which must be reachable pre-auth. This is
  // defense-in-depth so a new /api/admin/* route can't be reached unauthenticated
  // by forgetting its own requireCapability check.
  const isAdminPage = pathname.startsWith('/admin') && pathname !== '/admin/login'
  const isAdminApi = pathname.startsWith('/api/admin') && !pathname.startsWith('/api/admin/auth')
  if ((isAdminPage || isAdminApi) && isAdminEnabledEdge()) {
    // Coarse, edge-safe check only: a valid break-glass password session OR a
    // valid signed OIDC identity cookie. The live role lookup happens in node.
    const passwordAuthed = await isAdminAuthenticatedEdge(request.cookies.get(ADMIN_SESSION_COOKIE)?.value)
    const authed = passwordAuthed || Boolean(await verifySession(request.cookies.get(SESSION_COOKIE)?.value))
    if (!authed) {
      if (isAdminApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/admin/login'
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  if (
    docsAccessEnabled &&
    !pathname.startsWith('/admin') &&
    !pathname.startsWith('/api/admin') &&
    !pathname.startsWith('/api/analytics') &&
    !pathname.startsWith('/api/access') &&
    // The same-origin Thally Cloud handshake authenticates server-to-server with the
    // site token. It must remain reachable when the docs themselves are gated.
    pathname !== '/api/cloud/handshake' &&
    // The Thally Track webhook is called by GitHub, which can't hold a docs-access
    // cookie — it authenticates itself via HMAC signature instead.
    !pathname.startsWith('/api/track') &&
    pathname !== '/access' &&
    !pathname.startsWith('/_next') &&
    // Public agent-discovery + crawler-control docs (robots.txt, sitemap,
    // llms.txt, /.well-known/*, auth.md, …) must stay machine-reachable even
    // under docs-access protection — otherwise an MCP client or crawler gets
    // the HTML /access page instead of the JSON/markdown it asked for, and the
    // anonymous-access promises in auth.md / oauth-protected-resource go false.
    !isPublicAgentEndpoint(pathname) &&
    !(await isDocsAccessGrantedEdge(request.cookies.get(DOCS_ACCESS_COOKIE)?.value, docsAccessEnabled))
  ) {
    const accessUrl = request.nextUrl.clone()
    accessUrl.pathname = '/access'
    accessUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(accessUrl)
  }

  if (shouldTrackRequest(request, pathname)) {
    event.waitUntil(sendAnalyticsEvent(request, pathname))
  }

  // `.md` page mirrors rewrite to the markdown API — but /skill.md, /AGENTS.md,
  // /auth.md, and Agent Skills files under /.well-known/ are their own
  // generated routes, so leave them alone.
  //
  // RESERVED SLUG: because /auth.md is served by the generated agent-auth guide
  // (via a next.config.ts rewrite to /api/well-known), 'auth' is a reserved
  // top-level slug on this template. A real docs page slugged 'auth' would have
  // its .md mirror silently shadowed by that boilerplate. We can't safely
  // resolve this here: middleware runs on the edge, and the only doc-slug
  // enumerator (getNavigablePageIds/getDocEntries) lives in a module that
  // imports node:fs at top scope, so it can't be bundled into edge middleware.
  // A docs.json-based check would also be *wrong*, not just unavailable — the
  // .md mirror resolves against fs.existsSync(src/content/auth.mdx), i.e. file
  // existence, not nav membership. The real fix belongs in the nodejs-runtime
  // /api/well-known route (which can use fs) or the next.config.ts rewrite —
  // both outside this file.
  if (
    pathname.endsWith('.md') &&
    pathname !== '/skill.md' &&
    pathname !== '/AGENTS.md' &&
    pathname !== '/auth.md' &&
    !pathname.startsWith('/.well-known/')
  ) {
    const slugPath = pathname.slice(1, -3)
    if (slugPath) {
      const url = request.nextUrl.clone()
      url.pathname = `/api/markdown/${slugPath}`
      // URL-distinct (.md) — safe to fully CDN-cache.
      return applyManagedContentCacheHeaders(NextResponse.rewrite(url), pathname, contentCachePublic)
    }
  }

  if (isAgentRequest(request, pathname) && !isMachineEndpoint(pathname)) {
    const slugPath = pathname === '/' ? 'introduction' : pathname.slice(1)
    const format = request.nextUrl.searchParams.get('format')
    const url = request.nextUrl.clone()
    url.pathname = `/api/docs/${slugPath}`
    url.searchParams.delete('format')

    const requestHeaders = new Headers(request.headers)
    if (format === 'json' || format === 'ldjson' || format === 'md') {
      requestHeaders.set('x-thally-format', format)
    }

    // Tag-only: this response varies on User-Agent/Accept under the browser
    // URL's cache key, so it must never be CDN-cached (see helper docs).
    return applyManagedContentCacheHeaders(
      NextResponse.rewrite(url, { request: { headers: requestHeaders } }),
      pathname,
      contentCachePublic,
      { cdnCacheable: false },
    )
  }

  // Advertise the llms.txt discovery endpoint on HTML doc-page responses, so
  // agents and crawlers find the index without guessing. The `Link` header stays
  // relative (resolved against the request URL per RFC 8288); `X-Llms-Txt` is a
  // custom header agents read directly, so it carries an absolute URL. Only
  // content pages get the headers (not API/admin/_next).
  const response = NextResponse.next()
  if (!pathname.startsWith('/api') && !pathname.startsWith('/admin') && !pathname.startsWith('/_next')) {
    response.headers.append('Link', '</llms.txt>; rel="llms-txt"')
    // Standard relation types agents actually dereference (RFC 8288): the
    // Markdown alternate of the corpus, the OpenAPI description
    // (rel="service-desc", RFC 9727), and the API catalog (rel="api-catalog").
    response.headers.append('Link', '</llms.txt>; rel="alternate"; type="text/markdown"')
    response.headers.append('Link', '</openapi.yaml>; rel="service-desc"; type="application/yaml"')
    response.headers.append('Link', '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"')
    response.headers.set('X-Llms-Txt', `${request.nextUrl.origin}/llms.txt`)
  }
  // Full caching is safe here: RSC payload requests share doc-page pathnames
  // but stay cache-distinct via their `_rsc` query param, and every other
  // variant agents use is URL-distinct (`.md`, `?format=`).
  return applyManagedContentCacheHeaders(response, pathname, contentCachePublic)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
