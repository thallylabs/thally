/**
 * Final pass over a migrated redirect set. Next.js applies a redirect before it
 * looks for a page, so a redirect whose source is a served page hides that page,
 * and two redirects that point at each other never settle. Every platform and
 * every step that adds redirects (source config, generated aliases, remote API
 * specs) is checked here once, instead of each caller guarding its own additions.
 */

import type { MigrationDocsConfig, MigrationPage, MigrationWarning } from './types.js'

const LISTED = 10

/**
 * A fully literal site path, without a trailing slash and in lower case; null
 * for patterns, queries and fragments. Next matches a redirect source without
 * regard to case, so `/Guide` redirects a visit to `/guide` too.
 */
export function literalRoute(route: string): string | null {
  return route.startsWith('/') && !/[?:*#()[\]{}]/.test(route)
    ? route.replace(/\/+$/, '').toLowerCase() || '/'
    : null
}

/** The literal routes a site's pages are served at, as `literalRoute` writes them; a directory page (`section/index`) is served at its parent route too. */
export function servedRoutes(pages: ReadonlyArray<Pick<MigrationPage, 'id'>>): Set<string> {
  return new Set(pages.flatMap((page) => [`/${page.id}`, `/${page.id.replace(/\/index$/, '')}`]).map((route) => route.toLowerCase()))
}

function list(sources: Array<string>): string {
  return `${sources.slice(0, LISTED).join(', ')}${sources.length > LISTED ? ', ...' : ''}`
}

/**
 * Drop each literal redirect that hides a page of the site, and each one that
 * closes a loop with the redirects before it (so an authored redirect, listed
 * first, wins over a generated one). Patterns are left to the callers that
 * translate them: they cannot be compared with a page path.
 */
export function dropConflictingRedirects(
  config: MigrationDocsConfig,
  pages: ReadonlyArray<Pick<MigrationPage, 'id'>>,
  warnings: Array<MigrationWarning>,
): MigrationDocsConfig {
  if (!config.redirects?.length) return config
  const served = servedRoutes(pages)
  const hidden: Array<string> = []
  const looping: Array<string> = []
  // Redirects kept so far by literal source; Next uses the first match, so a later duplicate never fires.
  // A kept source points at the end of its chain, so a walk is short however the redirects are ordered.
  const kept = new Map<string, string>()
  const chainEnd = (route: string): string => {
    let end = route
    while (kept.has(end)) end = kept.get(end)!
    for (let step = route; step !== end;) {
      const next = kept.get(step)!
      kept.set(step, end)
      step = next
    }
    return end
  }
  const redirects = config.redirects.filter((redirect) => {
    const source = literalRoute(redirect.source)
    if (!source) return true
    if (served.has(source)) {
      hidden.push(redirect.source)
      return false
    }
    const destination = literalRoute(redirect.destination)
    if (!destination || kept.has(source)) return true
    // `source` has no redirect of its own yet, so it can only end the chain from `destination`: this redirect would close a cycle.
    if (chainEnd(destination) === source) {
      looping.push(`${redirect.source} -> ${redirect.destination}`)
      return false
    }
    kept.set(source, destination)
    return true
  })
  if (hidden.length > 0) {
    warnings.push({
      code: 'unsupported-config',
      message: `Skipped ${hidden.length} redirect${hidden.length === 1 ? '' : 's'} from ${list(hidden)}: ${hidden.length === 1 ? 'that URL is' : 'those URLs are'} also ${hidden.length === 1 ? 'a page' : 'pages'} in this site, and a redirect would hide ${hidden.length === 1 ? 'it' : 'them'}. To redirect instead, delete the page and add the redirect to docs.json.`,
    })
  }
  if (looping.length > 0) {
    warnings.push({
      code: 'unsupported-config',
      message: `Skipped ${looping.length} redirect${looping.length === 1 ? '' : 's'} that would send visitors in a circle: ${list(looping)}. Check these redirects in the source docs.`,
    })
  }
  if (redirects.length === config.redirects.length) return config
  const result: MigrationDocsConfig = { ...config, redirects }
  if (redirects.length === 0) delete result.redirects
  return result
}
