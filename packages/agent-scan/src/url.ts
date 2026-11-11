/**
 * URL normalization and docs-root rules shared by sampling, canonical checks
 * and the frame builder. Normalization lower-cases the scheme and host, drops
 * the default port and the fragment, collapses an empty path to `/` and keeps
 * the query. For equality only, a trailing `/` is insignificant.
 */

/** Parse and normalize an absolute http(s) URL; null when it cannot be used. */
export function normalizeUrl(input: string, base?: string): string | null {
  let url: URL
  try {
    url = base === undefined ? new URL(input) : new URL(input, base)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.hash = ''
  return url.href
}

/** Comparison key: normalized URL with any trailing `/` on a non-root path removed. */
export function equalityKey(input: string): string {
  const url = new URL(input)
  url.hash = ''
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1)
  return url.href
}

/** True when two URLs are equal under the normalization rules. */
export function sameUrl(a: string, b: string): boolean {
  try {
    return equalityKey(a) === equalityKey(b)
  } catch {
    return false
  }
}

/** The directory path of a docs root URL; always ends with `/`. */
export function rootPathOf(docsRoot: string): string {
  return new URL(docsRoot).pathname
}

/**
 * True when `candidate` is on the docs root's origin and its path equals the
 * root path or sits below it. Segment-safe: `/docs/` does not cover `/docsearch`.
 */
export function isUnderRoot(candidate: string, docsRoot: string): boolean {
  let url: URL
  let root: URL
  try {
    url = new URL(candidate)
    root = new URL(docsRoot)
  } catch {
    return false
  }
  if (url.origin !== root.origin) return false
  const rootPath = root.pathname
  if (url.pathname === rootPath || url.pathname.startsWith(rootPath)) return true
  // `/docs` is the root itself when the root path is `/docs/`.
  return rootPath.length > 1 && url.pathname === rootPath.slice(0, -1)
}

/**
 * Derive the docs root from the input URL and the final URL of the root fetch:
 * a final path ending in `/` is the root; an unchanged path without a slash
 * becomes a directory (`/docs` -> `/docs/`); otherwise the parent directory.
 */
export function deriveDocsRoot(input: string, finalUrl: string): string {
  const inputUrl = new URL(input)
  const final = new URL(finalUrl)
  let rootPath: string
  if (final.pathname.endsWith('/')) rootPath = final.pathname
  else if (inputUrl.pathname === final.pathname && inputUrl.origin === final.origin) rootPath = `${final.pathname}/`
  else rootPath = final.pathname.slice(0, final.pathname.lastIndexOf('/') + 1)
  return `${final.origin}${rootPath}`
}

function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host
}

/**
 * Same site, from `from` to `to`: the same hostname apart from an added or
 * removed `www.`, the same scheme or an http-to-https upgrade (never a
 * downgrade), and the same port (default ports are equal to each other on an
 * upgrade).
 */
export function isSameSite(from: string, to: string): boolean {
  let x: URL
  let y: URL
  try {
    x = new URL(from)
    y = new URL(to)
  } catch {
    return false
  }
  if (stripWww(x.hostname) !== stripWww(y.hostname)) return false
  if (x.protocol === y.protocol) return x.port === y.port
  if (x.protocol === 'http:' && y.protocol === 'https:') return x.port === y.port
  return false
}

/** Path plus query, the form robots rules match against. */
export function robotsPath(input: string): string {
  const url = new URL(input)
  return `${url.pathname}${url.search}`
}

/** Code-unit comparison; never locale dependent. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
