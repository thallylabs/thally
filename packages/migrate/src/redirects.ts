/**
 * Final pass over a migrated redirect set. Next.js applies a redirect before it
 * looks for a page, so a redirect whose source is a served page hides that page,
 * and two redirects that point at each other never settle. Next also parses a
 * redirect source as a route pattern, so one with pattern operators fails the
 * whole build. Every platform and every step that adds redirects (source
 * config, generated aliases, remote API specs) is checked here once, instead of
 * each caller guarding its own additions.
 *
 * A site runs on either of two servers: `next start` matches a redirect source
 * without regard to letter case, while the Cloudflare build matches it exactly.
 * A conflict is judged by the stricter reading, so a redirect that would hide a
 * page or loop on either server is left out.
 */

import type { MigrationDocsConfig, MigrationPage, MigrationWarning } from './types.js'

const LISTED = 10

/** A fully literal site path, without a trailing slash and in the case it was written; null for patterns, queries and fragments. */
function exactRoute(route: string): string | null {
  return route.startsWith('/') && !/[?:*#()[\]{}]/.test(route)
    ? route.replace(/\/+$/, '') || '/'
    : null
}

/** `exactRoute` in lower case: the form routes are compared in, so `/Guide` and `/guide` are one address. */
export function literalRoute(route: string): string | null {
  return exactRoute(route)?.toLowerCase() ?? null
}

/** The routes a site's pages are served at, in the case they are written; a directory page (`section/index`) is served at its parent route too. */
function pageRoutes(pages: ReadonlyArray<Pick<MigrationPage, 'id'>>): Array<string> {
  return pages.flatMap((page) => [`/${page.id}`, `/${page.id.replace(/\/index$/, '')}`])
}

/** The literal routes a site's pages are served at, as `literalRoute` writes them. */
export function servedRoutes(pages: ReadonlyArray<Pick<MigrationPage, 'id'>>): Set<string> {
  return new Set(pageRoutes(pages).map((route) => route.toLowerCase()))
}

function list(sources: Array<string>): string {
  return `${sources.slice(0, LISTED).join(', ')}${sources.length > LISTED ? ', ...' : ''}`
}

/** Characters Next's route-pattern parser reads as operators, so a source holding one (Mintlify's literal `/client/c++`) is rejected. */
const ROUTE_PATTERN_OPERATORS = /[+?()[\]{}]/

/**
 * Drop each redirect Next.js cannot serve as written: one back to its own
 * route (a trailing slash is the same route; a query or fragment carries
 * intent, so it is kept) and one whose source has route-pattern operators,
 * which would fail the build. An omitted address with operators is named in one
 * warning; a self-redirect gets its own.
 */
export function dropUnroutableRedirects(config: MigrationDocsConfig, warnings: Array<MigrationWarning>): MigrationDocsConfig {
  if (!config.redirects?.length) return config
  const unmatchable: Array<string> = []
  const redirects = config.redirects.filter((redirect) => {
    // Exact on purpose: a redirect back to the same address in another case is a conflict for `dropConflictingRedirects`, which says why.
    const source = exactRoute(redirect.source)
    if (source && source === exactRoute(redirect.destination)) {
      warnings.push({ code: 'unsupported-config', message: `Self-redirect from ${redirect.source} to ${redirect.destination} was omitted.` })
      return false
    }
    if (!ROUTE_PATTERN_OPERATORS.test(redirect.source)) return true
    unmatchable.push(redirect.source)
    return false
  })
  if (unmatchable.length > 0) {
    warnings.push({
      code: 'unsupported-config',
      message: `Skipped ${unmatchable.length} redirect${unmatchable.length === 1 ? '' : 's'} from ${list(unmatchable)}: ${unmatchable.length === 1 ? 'that address has' : 'those addresses have'} a character (+ ? ( ) [ ] { }) that Next.js reads as route syntax and cannot match literally, so visits to ${unmatchable.length === 1 ? 'it' : 'them'} will not redirect.`,
    })
  }
  if (redirects.length === config.redirects.length) return config
  const result: MigrationDocsConfig = { ...config, redirects }
  if (redirects.length === 0) delete result.redirects
  return result
}

/**
 * The redirects kept so far, by source. Next uses the first match, so a later
 * duplicate never fires. A kept source points at the end of its chain, so a
 * walk is short however the redirects are ordered.
 */
function redirectChains(): { kept: Map<string, string>; chainEnd: (route: string) => string } {
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
  return { kept, chainEnd }
}

/**
 * Drop each literal redirect that hides a page of the site, and each one that
 * closes a loop with the redirects before it (so an authored redirect, listed
 * first, wins over a generated one). Routes are compared without regard to
 * letter case; a conflict that exists only because of that gets its own
 * warning, which says the redirect can come back on a case-sensitive host.
 * Patterns are left to the callers that translate them: they cannot be
 * compared with a page path.
 */
export function dropConflictingRedirects(
  config: MigrationDocsConfig,
  pages: ReadonlyArray<Pick<MigrationPage, 'id'>>,
  warnings: Array<MigrationWarning>,
): MigrationDocsConfig {
  if (!config.redirects?.length) return config
  const served = servedRoutes(pages)
  const servedAsWritten = new Set(pageRoutes(pages))
  const hidden: Array<string> = []
  const hiddenByCase: Array<string> = []
  const looping: Array<string> = []
  const loopingByCase: Array<string> = []
  // The same walk twice: with case ignored it decides what is dropped, as written it tells whether case alone made the conflict.
  const folded = redirectChains()
  const asWritten = redirectChains()
  const redirects = config.redirects.filter((redirect) => {
    const source = literalRoute(redirect.source)
    const destination = literalRoute(redirect.destination)
    if (!source) return true
    const writtenSource = exactRoute(redirect.source)!
    if (served.has(source)) {
      const hides = servedAsWritten.has(writtenSource) ? hidden : hiddenByCase
      hides.push(redirect.source)
      return false
    }
    if (!destination) return true
    const writtenDestination = exactRoute(redirect.destination)!
    if (!folded.kept.has(source)) {
      // `source` has no redirect of its own yet, so it can only end the chain from `destination`: this redirect would close a cycle.
      if (folded.chainEnd(destination) === source) {
        const loopsAsWritten = !asWritten.kept.has(writtenSource) && asWritten.chainEnd(writtenDestination) === writtenSource
        const loops = loopsAsWritten ? looping : loopingByCase
        loops.push(`${redirect.source} -> ${redirect.destination}`)
        return false
      }
      folded.kept.set(source, destination)
    }
    if (!asWritten.kept.has(writtenSource)) asWritten.kept.set(writtenSource, writtenDestination)
    return true
  })
  if (hidden.length > 0) {
    warnings.push({
      code: 'unsupported-config',
      message: `Skipped ${hidden.length} redirect${hidden.length === 1 ? '' : 's'} from ${list(hidden)}: ${hidden.length === 1 ? 'that URL is' : 'those URLs are'} also ${hidden.length === 1 ? 'a page' : 'pages'} in this site, and a redirect would hide ${hidden.length === 1 ? 'it' : 'them'}. To redirect instead, delete the page and add the redirect to docs.json.`,
    })
  }
  if (hiddenByCase.length > 0) {
    const one = hiddenByCase.length === 1
    warnings.push({
      code: 'unsupported-config',
      message: `Skipped ${hiddenByCase.length} redirect${one ? '' : 's'} from ${list(hiddenByCase)}: ${one ? 'that URL differs' : 'those URLs differ'} only in letter case from ${one ? 'a page' : 'pages'} in this site, so on a server that ignores letter case ${one ? 'it' : 'they'} would hide ${one ? 'that page' : 'those pages'}. If your host matches URLs case-sensitively, add ${one ? 'it' : 'them'} back to docs.json.`,
    })
  }
  if (looping.length > 0) {
    warnings.push({
      code: 'unsupported-config',
      message: `Skipped ${looping.length} redirect${looping.length === 1 ? '' : 's'} that would send visitors in a circle: ${list(looping)}. Check these redirects in the source docs.`,
    })
  }
  if (loopingByCase.length > 0) {
    const one = loopingByCase.length === 1
    warnings.push({
      code: 'unsupported-config',
      message: `Skipped ${loopingByCase.length} redirect${one ? '' : 's'} that would send visitors in a circle on a server that ignores letter case, since the addresses involved differ only in letter case: ${list(loopingByCase)}. If your host matches URLs case-sensitively, add ${one ? 'it' : 'them'} back to docs.json.`,
    })
  }
  if (redirects.length === config.redirects.length) return config
  const result: MigrationDocsConfig = { ...config, redirects }
  if (redirects.length === 0) delete result.redirects
  return result
}
