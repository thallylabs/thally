/**
 * Docs-root resolution for one repository homepage. Candidates are tried in
 * a fixed priority order and the first that serves HTML with status 200
 * wins: a `docs.` subdomain on the registrable domain, a `/docs/` path, the
 * homepage itself when it looks like docs, then a homepage link labelled as
 * documentation. Robots, the rate limiter and the SSRF guard apply.
 */

import { load } from 'cheerio'
import { getDomain } from 'tldts'

import { parsePage } from '../html.js'
import type { Fetcher } from '../net/fetcher.js'
import { checkFetchableUrl } from '../net/guard.js'
import { detectPlatform } from '../platform.js'
import type { FetchOutcome } from '../types.js'
import { deriveDocsRoot, isSameSite, normalizeUrl } from '../url.js'

/** Inclusion or exclusion reason for a frame row. */
export type FrameReason =
  | 'docs_subdomain' | 'docs_path' | 'homepage_is_docs' | 'homepage_docs_link'
  | 'no_homepage' | 'invalid_homepage' | 'github_hosted' | 'no_docs_found' | 'unreachable'
  | 'robots_disallowed' | 'private_address' | 'duplicate_docs_root'

/** Resolution outcome for one homepage. */
export interface DocsRootResolution {
  decision: 'include' | 'exclude'
  reason: FrameReason
  docsRoot: string | null
}

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com', 'gist.github.com'])
const DOCS_HOST_PREFIXES = ['docs.', 'doc.', 'developer.', 'developers.', 'dev.']
const DOCS_LINK_TEXT = new Set(['docs', 'documentation', 'guide', 'guides', 'manual'])

function isHtml(outcome: FetchOutcome): boolean {
  return outcome.error === null && outcome.status === 200 &&
    (outcome.contentType === 'text/html' || outcome.contentType === 'application/xhtml+xml')
}

function exclude(reason: FrameReason): DocsRootResolution {
  return { decision: 'exclude', reason, docsRoot: null }
}

/** Normalize a raw homepage field to an absolute URL, adding `https://` when no scheme is present. */
export function normalizeHomepage(raw: string | null): string | null | 'invalid' {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  return normalizeUrl(withScheme) ?? 'invalid'
}

/** Resolve the docs root for one homepage. */
export async function resolveDocsRoot(rawHomepage: string | null, fetcher: Fetcher, allowPrivateNetwork: boolean): Promise<DocsRootResolution> {
  const homepage = normalizeHomepage(rawHomepage)
  if (homepage === null) return exclude('no_homepage')
  if (homepage === 'invalid') return exclude('invalid_homepage')
  const homeUrl = new URL(homepage)
  const host = homeUrl.hostname.toLowerCase()
  if (GITHUB_HOSTS.has(host)) return exclude('github_hosted')
  const guard = checkFetchableUrl(homepage, allowPrivateNetwork)
  if (guard === 'private_address') return exclude('private_address')
  if (guard) return exclude('invalid_homepage')

  let attempted = 0
  let robotsBlocked = 0
  let homepageReachable = false
  let homepageOutcome: FetchOutcome | null = null

  const tryCandidate = async (url: string): Promise<FetchOutcome | null> => {
    attempted++
    const outcome = await fetcher.get(url, { purpose: 'html', allowOffsite: true })
    if (outcome.error === 'robots_disallowed') robotsBlocked++
    return isHtml(outcome) ? outcome : null
  }
  const accept = (candidate: string, outcome: FetchOutcome, reason: FrameReason): DocsRootResolution => {
    if (GITHUB_HOSTS.has(new URL(outcome.finalUrl).hostname.toLowerCase())) return exclude('github_hosted')
    return { decision: 'include', reason, docsRoot: deriveDocsRoot(candidate, outcome.finalUrl) }
  }

  if (!host.startsWith('docs.')) {
    // The Public Suffix List (private section included) keeps probes such as
    // `docs.co.uk` or `docs.github.io` from ever being generated; a bare
    // suffix yields no registrable domain and the step is skipped.
    const domain = getDomain(host, { allowPrivateDomains: true })
    if (domain) {
      const candidate = `https://docs.${domain}/`
      const hit = await tryCandidate(candidate)
      if (hit) return accept(candidate, hit, 'docs_subdomain')
    }
  }

  const docsPath = `${homeUrl.origin}/docs/`
  const pathHit = await tryCandidate(docsPath)
  if (pathHit) return accept(docsPath, pathHit, 'docs_path')

  attempted++
  homepageOutcome = await fetcher.get(homepage, { purpose: 'html', allowOffsite: true })
  if (homepageOutcome.error === 'robots_disallowed') robotsBlocked++
  homepageReachable = homepageOutcome.status !== null
  if (isHtml(homepageOutcome)) {
    const page = parsePage(homepageOutcome.text ?? '', homepageOutcome.finalUrl)
    const platform = detectPlatform({ url: homepageOutcome.finalUrl, headers: homepageOutcome.headers, page })
    const finalHost = new URL(homepageOutcome.finalUrl).hostname.toLowerCase()
    const segments = new URL(homepageOutcome.finalUrl).pathname.toLowerCase().split('/')
    const looksLikeDocs =
      (platform.confidence === 'high' && platform.platform !== 'nextjs' && platform.platform !== 'unknown') ||
      DOCS_HOST_PREFIXES.some((prefix) => finalHost.startsWith(prefix)) ||
      finalHost.endsWith('.readthedocs.io') || finalHost.endsWith('.gitbook.io') ||
      segments.includes('docs') || segments.includes('documentation')
    if (looksLikeDocs) return accept(homepage, homepageOutcome, 'homepage_is_docs')

    const $ = load(homepageOutcome.text ?? '')
    let linkTarget: string | null = null
    $('a[href]').each((_, element) => {
      if (linkTarget) return
      const label = $(element).text().replace(/\s+/g, ' ').trim().toLowerCase()
      if (!DOCS_LINK_TEXT.has(label)) return
      const target = normalizeUrl($(element).attr('href') ?? '', homepageOutcome!.finalUrl)
      if (target && isSameSite(target, homepageOutcome!.finalUrl)) linkTarget = target
    })
    if (linkTarget) {
      const linkHit = await tryCandidate(linkTarget)
      if (linkHit) return accept(linkTarget, linkHit, 'homepage_docs_link')
    }
  }

  if (attempted > 0 && robotsBlocked === attempted) return exclude('robots_disallowed')
  if (homepageOutcome?.error === 'private_address') return exclude('private_address')
  return exclude(homepageReachable ? 'no_docs_found' : 'unreachable')
}
