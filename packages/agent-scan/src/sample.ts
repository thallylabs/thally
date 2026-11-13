/**
 * Deterministic page sampling. The same sitemap URLs, docs root and robots
 * rules always give the same sample: URLs are normalized, de-duplicated,
 * robots-filtered, sorted by code unit and picked at a constant stride.
 */

import { methodology } from './methodology/methodology.js'
import type { RobotsRules } from './types.js'
import { compareCodeUnits, equalityKey, isUnderRoot, normalizeUrl, robotsPath, sameUrl } from './url.js'

const NON_HTML_EXTENSIONS = /\.(pdf|zip|gz|tgz|tar|bz2|xz|7z|rar|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|mp3|mp4|m4a|webm|mov|avi|wav|ogg|woff2?|ttf|otf|eot|css|js|mjs|json|xml|txt|csv|exe|dmg|pkg|deb|rpm|apk|whl|jar)$/i

/**
 * Eligible URLs: normalized, under the docs root, not the root itself,
 * allowed by robots for the scanner, de-duplicated by equality key and sorted.
 */
export function eligibleUrls(urls: string[], docsRoot: string, robots: RobotsRules): string[] {
  const token = methodology.robotsProductToken
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    const url = normalizeUrl(raw)
    if (!url || !isUnderRoot(url, docsRoot) || sameUrl(url, docsRoot)) continue
    if (!robots.isAllowed(token, robotsPath(url))) continue
    const key = equalityKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url)
  }
  return out.sort(compareCodeUnits)
}

/**
 * Pick the sample from sorted eligible URLs: all of them when there are at
 * most `pages`, otherwise `U[i * k]` for `k = floor(n / pages)`.
 */
export function pickSample(sorted: string[], pages: number = methodology.sampling.pages): string[] {
  if (sorted.length <= pages) return [...sorted]
  const k = Math.floor(sorted.length / pages)
  const picked: string[] = []
  for (let i = 0; i < pages; i++) picked.push(sorted[i * k])
  return picked
}

/**
 * Filter links found on a page for the breadth-first fallback: same docs
 * root, not the root, robots-allowed, not an obvious non-HTML file, and not
 * already in `exclude`. Document order is kept.
 */
export function bfsCandidates(links: string[], docsRoot: string, robots: RobotsRules, exclude: Iterable<string>): string[] {
  const token = methodology.robotsProductToken
  const seen = new Set<string>()
  for (const url of exclude) seen.add(equalityKey(url))
  const out: string[] = []
  for (const raw of links) {
    const url = normalizeUrl(raw)
    if (!url || !isUnderRoot(url, docsRoot) || sameUrl(url, docsRoot)) continue
    if (NON_HTML_EXTENSIONS.test(new URL(url).pathname)) continue
    if (!robots.isAllowed(token, robotsPath(url))) continue
    const key = equalityKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url)
  }
  return out
}
