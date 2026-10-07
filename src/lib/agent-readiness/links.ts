/**
 * Internal link and anchor resolution over the structured content graph.
 *
 * An agent that follows a dead link wastes a fetch and often abandons the
 * task, so readiness flags root-relative links that resolve to no published
 * page and fragments that name no heading. Inputs come from the content graph
 * (`content.links`, `content.headings`), never a second parse of the source.
 *
 * Resolution is deliberately conservative: anything this module cannot prove
 * broken (relative links, static files, runtime `/api/*` endpoints, redirect
 * targets, translated paths) is treated as valid. `thally check` remains the
 * authoritative authoring-time link linter; this signal measures what agents
 * hit on the published site.
 */

import type { BrokenLinkFact } from '@/lib/agent-readiness/types'

/** Upper bound on broken links recorded per page; the count still reflects the page. */
export const MAX_BROKEN_LINKS_PER_PAGE = 20

export interface LinkIndex {
  /** Published page paths mapped to the anchor ids each page exposes. */
  pages: ReadonlyMap<string, ReadonlySet<string>>
  /**
   * Paths that resolve but whose anchors are not in the content graph:
   * generated OpenAPI operation pages and operation-bound docs pages.
   */
  extraPaths: ReadonlySet<string>
  /** Compiled `docs.json` redirect sources. */
  redirects: ReadonlyArray<RegExp>
  /** Secondary locale codes that may prefix any page path. */
  locales: ReadonlySet<string>
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const FILE_EXTENSION = /\.[a-z0-9]{1,8}$/i
const RUNTIME_PREFIXES = ['/api/', '/admin', '/_next/']

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Normalize a site path: decoded, no trailing slash (except root). */
export function normalizePath(path: string): string {
  const decoded = safeDecode(path)
  if (decoded.length > 1 && decoded.endsWith('/')) return decoded.replace(/\/+$/, '') || '/'
  return decoded || '/'
}

/**
 * Compile a docs.json redirect source (`/old/:slug*`, `/a/:id`) to a matcher.
 * A source that cannot be compiled matches nothing rather than everything.
 */
export function compileRedirectSource(source: string): RegExp | null {
  if (typeof source !== 'string' || !source.startsWith('/')) return null
  try {
    const pattern = normalizePath(source)
      .split('/')
      .map((segment) => {
        const param = /^:[A-Za-z_][A-Za-z0-9_]*([*+?])?$/.exec(segment)
        if (!param) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (param[1] === '*') return '.*'
        if (param[1] === '+') return '.+'
        if (param[1] === '?') return '[^/]*'
        return '[^/]+'
      })
      .join('/')
    // `/a/:rest*` must also match `/a`, so let a trailing wildcard swallow its slash.
    return new RegExp(`^${pattern.replace(/\/\.\*$/, '(?:/.*)?')}$`)
  } catch {
    return null
  }
}

function resolvesAsPage(path: string, index: LinkIndex): ReadonlySet<string> | 'unchecked' | null {
  const page = index.pages.get(path)
  if (page) return page
  if (index.extraPaths.has(path)) return 'unchecked'
  const [, first, ...rest] = path.split('/')
  if (first && index.locales.has(first)) {
    // A translated page may fall back to the default-locale page. Its anchors
    // can differ by language, so only the page itself is checked.
    const unprefixed = rest.length ? `/${rest.join('/')}` : '/'
    if (index.pages.has(unprefixed) || index.extraPaths.has(unprefixed)) return 'unchecked'
  }
  if (index.redirects.some((matcher) => matcher.test(path))) return 'unchecked'
  return null
}

/**
 * Return the links on one page that do not resolve. `ownAnchors` are the
 * anchor ids of the page the links appear on (for `#fragment` links), or
 * null when that page renders anchors the content graph cannot see.
 */
export function findBrokenLinks(
  urls: ReadonlyArray<string>,
  ownAnchors: ReadonlySet<string> | null,
  index: LinkIndex,
): Array<BrokenLinkFact> {
  const broken: Array<BrokenLinkFact> = []
  const seen = new Set<string>()

  for (const raw of urls) {
    if (broken.length >= MAX_BROKEN_LINKS_PER_PAGE) break
    const target = typeof raw === 'string' ? raw.trim() : ''
    if (!target || seen.has(target)) continue
    seen.add(target)

    if (target.startsWith('#')) {
      const anchor = safeDecode(target.slice(1))
      if (anchor && ownAnchors && !ownAnchors.has(anchor)) broken.push({ target, kind: 'anchor' })
      continue
    }
    // External, protocol-relative, mailto:, and relative links are out of scope.
    if (!target.startsWith('/') || target.startsWith('//') || SCHEME.test(target)) continue

    const hashAt = target.indexOf('#')
    const beforeHash = hashAt >= 0 ? target.slice(0, hashAt) : target
    const anchor = hashAt >= 0 ? safeDecode(target.slice(hashAt + 1)) : ''
    const path = normalizePath(beforeHash.split('?')[0])

    if (FILE_EXTENSION.test(path)) continue
    const resolved = resolvesAsPage(path, index)
    if (resolved === 'unchecked') continue
    if (resolved === null) {
      // Runtime routes (search API, admin, assets) are not content pages.
      if (path === '/api' || RUNTIME_PREFIXES.some((prefix) => path.startsWith(prefix))) continue
      broken.push({ target, kind: 'page' })
      continue
    }
    if (anchor && !resolved.has(anchor)) broken.push({ target, kind: 'anchor' })
  }

  return broken
}
