/**
 * The per-site request plan. Execution is sequential and its order is the
 * budget drop policy: robots, docs root, llms.txt, llms-full.txt, sitemaps,
 * well-known probes, the first sample page, alternate probes, then the rest
 * of the sample. Overruns from redirects and retries therefore consume tail
 * sample pages first, never the binary site-level probes.
 */

import { gunzipSync } from 'node:zlib'

import { isJsonType, isValidLlmsFull, isValidLlmsTxt, isValidManifest, parseJsonObject } from './checks/discovery.js'
import type { AlternateAttempt, PageRecord, ProbeSet, SiteFacts } from './facts.js'
import { parsePage, type PageFacts } from './html.js'
import { methodology } from './methodology/methodology.js'
import { checkFetchableUrl } from './net/guard.js'
import type { Fetcher } from './net/fetcher.js'
import { bfsCandidates, eligibleUrls, pickSample } from './sample.js'
import { parseSitemap } from './sitemap.js'
import { jsonTitle, markdownTitle } from './text.js'
import type { ErrorCode, FetchOutcome, RobotsRules } from './types.js'
import { compareCodeUnits, deriveDocsRoot, isSameSite, isUnderRoot, normalizeUrl, robotsPath, rootPathOf } from './url.js'

/** Sample bookkeeping reported in the result. */
export interface SampleInfo {
  source: 'sitemap' | 'bfs' | 'root_only'
  sitemapUrlCount: number
  pages: string[]
  droppedForBudget: string[]
}

/** A gathered site, or the reason it could not be scanned. */
export type GatherResult =
  | { ok: true; facts: SiteFacts; sample: SampleInfo; rootHeaders: Array<[string, string]>; rootFinalUrl: string }
  | { ok: false; status: 'error' | 'skipped'; reason: ErrorCode; docsRoot: string | null }

const SKIP_REASONS: ReadonlySet<ErrorCode> = new Set(['private_address', 'robots_disallowed', 'robots_unreachable'])

function failure(reason: ErrorCode, docsRoot: string | null = null): GatherResult {
  return { ok: false, status: SKIP_REASONS.has(reason) ? 'skipped' : 'error', reason, docsRoot }
}

function isBudgetSkip(outcome: FetchOutcome): boolean {
  return outcome.error === 'budget_exhausted' && outcome.status === null && outcome.redirects === 0
}

function isHtmlType(contentType: string | null): boolean {
  return contentType === 'text/html' || contentType === 'application/xhtml+xml'
}

/** Parse a `Link` header into entries with lower-case params. */
export function parseLinkHeader(value: string): Array<{ href: string; params: Record<string, string> }> {
  const entries: Array<{ href: string; params: Record<string, string> }> = []
  for (const match of value.matchAll(/<([^>]*)>([^,<]*(?:"[^"]*"[^,<]*)*)/g)) {
    const params: Record<string, string> = {}
    for (const param of match[2].matchAll(/;\s*([a-zA-Z*-]+)\s*=\s*(?:"([^"]*)"|([^;,\s]*))/g)) {
      params[param[1].toLowerCase()] = (param[2] ?? param[3] ?? '').trim()
    }
    entries.push({ href: match[1].trim(), params })
  }
  return entries
}

function linkHeaders(outcome: FetchOutcome): Array<{ href: string; params: Record<string, string> }> {
  return outcome.headers.filter(([name]) => name === 'link').flatMap(([, value]) => parseLinkHeader(value))
}

function relHas(params: Record<string, string>, token: string): boolean {
  return (params.rel ?? '').toLowerCase().split(/\s+/).includes(token)
}

function isLlmsTarget(url: string): boolean {
  const path = new URL(url).pathname
  return path.endsWith('/llms.txt') || path.endsWith('/llms-full.txt')
}

function sitemapText(outcome: FetchOutcome): string | null {
  if (outcome.error || outcome.status !== 200 || !outcome.body) return null
  const body = outcome.body
  const gzipped = (body[0] === 0x1f && body[1] === 0x8b) || new URL(outcome.finalUrl).pathname.endsWith('.gz')
  if (!gzipped) return outcome.text
  try {
    return new TextDecoder('utf-8').decode(gunzipSync(body, { maxOutputLength: methodology.limits.maxBodyBytes }))
  } catch {
    return null
  }
}

function validAlternate(outcome: FetchOutcome, kind: 'markdown' | 'json'): { valid: boolean; title: string | null } {
  if (outcome.error || outcome.status !== 200) return { valid: false, title: null }
  if (kind === 'markdown') {
    const okType = outcome.contentType === 'text/markdown' || outcome.contentType === 'text/x-markdown' || outcome.contentType === 'text/plain'
    const text = (outcome.text ?? '').trim()
    if (!okType || text.startsWith('<')) return { valid: false, title: null }
    return { valid: true, title: markdownTitle(outcome.text ?? '') }
  }
  if (!isJsonType(outcome.contentType)) return { valid: false, title: null }
  const parsed = parseJsonObject(outcome.text)
  return parsed ? { valid: true, title: jsonTitle(parsed) } : { valid: false, title: null }
}

/**
 * Run the request plan for one site and collect the facts every check
 * evaluates. Site-level failures are returned, never thrown.
 */
export async function gatherSite(input: string, fetcher: Fetcher, allowPrivateNetwork: boolean): Promise<GatherResult> {
  const normalized = normalizeUrl(input.trim())
  if (!normalized) return failure('invalid_url')
  const guardError = checkFetchableUrl(normalized, allowPrivateNetwork)
  if (guardError) return failure(guardError)

  // 1. robots.txt for the input origin.
  const inputRobots = await fetcher.robotsFor(new URL(normalized).origin)
  if (inputRobots.kind === 'error') return failure(inputRobots.error)
  if (inputRobots.kind === 'unreachable') return failure('robots_unreachable')

  // 2. Docs root; may leave the site, and the final URL becomes the root.
  const root = await fetcher.get(normalized, { purpose: 'html', allowOffsite: true })
  if (root.error) return failure(root.error)
  if (root.status !== 200) return failure('http_status')
  if (!isHtmlType(root.contentType)) return failure('not_html')
  if (root.truncated) return failure('body_too_large')

  const docsRoot = deriveDocsRoot(normalized, root.finalUrl)
  const origin = new URL(docsRoot).origin
  const robotsState = await fetcher.robotsFor(origin)
  if (robotsState.kind === 'error') return failure(robotsState.error, docsRoot)
  if (robotsState.kind === 'unreachable') return failure('robots_unreachable', docsRoot)
  const robots: RobotsRules = robotsState.rules
  if (!robots.isAllowed(methodology.robotsProductToken, robotsPath(docsRoot))) return failure('robots_disallowed', docsRoot)

  const rootFacts = parsePage(root.text ?? '', root.finalUrl)
  const rootRecord: PageRecord = { url: root.finalUrl, isRoot: true, outcome: root, html: rootFacts }
  const rootLinkHeaderMcp = linkHeaders(root).some((entry) => relHas(entry.params, 'mcp'))
  const rootPath = rootPathOf(docsRoot)

  // 3. llms.txt, root-relative first.
  const llms: ProbeSet = { attempts: [], hit: null, skippedForBudget: false }
  const llmsCandidates = rootPath !== '/' ? [`${docsRoot}llms.txt`, `${origin}/llms.txt`] : [`${origin}/llms.txt`]
  for (const url of llmsCandidates) {
    const outcome = await fetcher.get(url, { purpose: 'llms' })
    if (isBudgetSkip(outcome)) {
      llms.skippedForBudget = true
      break
    }
    llms.attempts.push(outcome)
    if (isValidLlmsTxt(outcome)) {
      llms.hit = outcome
      break
    }
  }

  // 4. llms-full.txt beside the llms.txt hit, else at the origin. Prefix read only.
  const llmsFull: ProbeSet = { attempts: [], hit: null, skippedForBudget: false }
  const fullUrl = llms.hit ? new URL('llms-full.txt', llms.hit.requestedUrl).href : `${origin}/llms-full.txt`
  const fullOutcome = await fetcher.get(fullUrl, { purpose: 'llms', stopAfterBytes: methodology.probes.llmsFullPrefixBytes })
  if (isBudgetSkip(fullOutcome)) llmsFull.skippedForBudget = true
  else {
    llmsFull.attempts.push(fullOutcome)
    if (isValidLlmsFull(fullOutcome)) llmsFull.hit = fullOutcome
  }

  // 5. Sitemaps: robots Sitemap lines on this site, else conventional paths.
  const sitemapFacts: SiteFacts['sitemap'] = { attempts: [], parsed: [], locsUnderRoot: 0, skippedForBudget: false }
  const maxChildren = methodology.probes.sitemapMaxIndexChildren
  const maxSitemapFetches = 1 + maxChildren
  const fromRobots = robots.sitemaps.filter((url) => isSameSite(url, docsRoot))
  const topCandidates = fromRobots.length > 0
    ? fromRobots
    : [`${origin}/sitemap.xml`, ...(rootPath !== '/' ? [`${docsRoot}sitemap.xml`] : [])]
  const pageLocs: string[] = []
  const fetchSitemap = async (url: string) => {
    if (sitemapFacts.attempts.length >= maxSitemapFetches) return null
    const outcome = await fetcher.get(url, { purpose: 'sitemap' })
    if (isBudgetSkip(outcome)) {
      sitemapFacts.skippedForBudget = true
      return null
    }
    sitemapFacts.attempts.push(outcome)
    const text = sitemapText(outcome)
    if (text === null) return null
    const parsed = parseSitemap(text)
    if (parsed.kind) sitemapFacts.parsed.push(outcome.requestedUrl)
    return parsed
  }
  const underRootCount = (locs: string[]) => locs.filter((loc) => {
    const url = normalizeUrl(loc)
    return url !== null && isUnderRoot(url, docsRoot)
  }).length
  for (const candidate of topCandidates) {
    if (sitemapFacts.skippedForBudget) break
    const parsed = await fetchSitemap(candidate)
    if (!parsed || !parsed.kind) continue
    if (parsed.kind === 'urlset') {
      pageLocs.push(...parsed.locs)
    } else {
      const children = [...new Set(parsed.locs)]
        .filter((loc) => normalizeUrl(loc) !== null && isSameSite(loc, docsRoot))
        .sort(compareCodeUnits)
      const preferred = children.filter((loc) => {
        const path = new URL(loc).pathname
        return path.startsWith(rootPath) || path.toLowerCase().includes('docs')
      })
      const rest = children.filter((loc) => !preferred.includes(loc))
      for (const child of [...preferred, ...rest].slice(0, maxChildren)) {
        const childParsed = await fetchSitemap(child)
        if (!childParsed || childParsed.kind !== 'urlset') continue
        pageLocs.push(...childParsed.locs)
        if (underRootCount(childParsed.locs) >= methodology.sampling.pages) break
      }
    }
    break
  }
  sitemapFacts.locsUnderRoot = underRootCount(pageLocs)
  const eligible = eligibleUrls(pageLocs, docsRoot, robots)

  // 6. Well-known agent and MCP manifests; stop at the first hit.
  const wellKnown: ProbeSet = { attempts: [], hit: null, skippedForBudget: false }
  for (const path of methodology.probes.wellKnown) {
    const outcome = await fetcher.get(`${origin}${path}`, { purpose: 'well-known' })
    if (isBudgetSkip(outcome)) {
      wellKnown.skippedForBudget = true
      break
    }
    wellKnown.attempts.push(outcome)
    if (isValidManifest(outcome)) {
      wellKnown.hit = outcome
      break
    }
  }

  // Sample selection: sitemap stride, else breadth-first links.
  let source: SampleInfo['source']
  const queue: string[] = []
  if (eligible.length > 0) {
    source = 'sitemap'
    queue.push(...pickSample(eligible))
  } else {
    const links = bfsCandidates(rootFacts.links, docsRoot, robots, [docsRoot]).slice(0, methodology.sampling.pages)
    source = links.length > 0 ? 'bfs' : 'root_only'
    queue.push(...links)
  }

  const pages: PageRecord[] = [rootRecord]
  const sampledPages: string[] = [docsRoot]
  const droppedForBudget: string[] = []

  const fetchPage = async (url: string): Promise<PageRecord | null> => {
    const outcome = await fetcher.get(url, { purpose: 'html' })
    if (isBudgetSkip(outcome)) {
      droppedForBudget.push(url)
      return null
    }
    const isHtml = outcome.error === null && outcome.status === 200 && isHtmlType(outcome.contentType) &&
      !outcome.truncated && isSameSite(outcome.finalUrl, docsRoot)
    let html: PageFacts | null = null
    if (isHtml) html = parsePage(outcome.text ?? '', outcome.finalUrl)
    const record: PageRecord = { url, isRoot: false, outcome, html }
    pages.push(record)
    sampledPages.push(url)
    // Breadth-first expansion never costs extra requests: it only extends
    // the queue with links from pages already being fetched.
    if (source === 'bfs' && html && queue.length < methodology.sampling.pages) {
      const extra = bfsCandidates(html.links, docsRoot, robots, [docsRoot, ...queue])
      queue.push(...extra.slice(0, methodology.sampling.pages - queue.length))
    }
    return record
  }

  // 7. First sample page; it is the alternate probe page when it is HTML.
  let index = 0
  let probeRecord: PageRecord = rootRecord
  if (queue.length > 0) {
    const first = await fetchPage(queue[index++])
    if (first?.html) probeRecord = first
  }

  // 8. Alternate representations on the probe page; stop at the first valid one.
  const probeUrl = probeRecord.outcome.finalUrl
  const variants: Array<Omit<AlternateAttempt, 'outcome' | 'valid'> & { accept: string; purpose: 'alt-md' | 'alt-json' }> = []
  const htmlAlternate = probeRecord.html?.alternates.find((entry) => !isLlmsTarget(entry.href))
  const headerAlternate = linkHeaders(probeRecord.outcome)
    .filter((entry) => relHas(entry.params, 'alternate'))
    .map((entry) => ({ href: normalizeUrl(entry.href, probeUrl), type: (entry.params.type ?? '').toLowerCase() }))
    .find((entry) => entry.href && (entry.type === 'text/markdown' || entry.type === 'application/json') && !isLlmsTarget(entry.href))
  const linked = htmlAlternate ?? (headerAlternate ? { href: headerAlternate.href!, type: headerAlternate.type } : null)
  for (const variant of methodology.probes.alternateVariants) {
    if (variant === 'link_alternate' && linked) {
      const kind = linked.type === 'application/json' ? 'json' : 'markdown'
      variants.push({ variant, url: linked.href, kind, accept: kind === 'json' ? 'application/json' : 'text/markdown, text/plain;q=0.5', purpose: kind === 'json' ? 'alt-json' : 'alt-md' })
    } else if (variant === 'dot_md') {
      const url = new URL(probeUrl)
      url.search = ''
      url.pathname = url.pathname.endsWith('/') ? `${url.pathname}index.md` : `${url.pathname}.md`
      variants.push({ variant, url: url.href, kind: 'markdown', accept: 'text/markdown, text/plain;q=0.5', purpose: 'alt-md' })
    } else if (variant === 'accept_markdown') {
      variants.push({ variant, url: probeUrl, kind: 'markdown', accept: 'text/markdown', purpose: 'alt-md' })
    } else if (variant === 'format_json') {
      const url = new URL(probeUrl)
      url.searchParams.set('format', 'json')
      variants.push({ variant, url: url.href, kind: 'json', accept: 'application/json', purpose: 'alt-json' })
    }
  }
  const alternate: SiteFacts['alternate'] = { probePage: probeUrl, attempts: [], hit: null, title: null }
  for (const variant of variants) {
    const outcome = await fetcher.get(variant.url, { purpose: variant.purpose, accept: variant.accept })
    if (isBudgetSkip(outcome)) {
      alternate.attempts.push({ variant: variant.variant, url: variant.url, kind: variant.kind, outcome: null, valid: false })
      continue
    }
    const { valid, title } = validAlternate(outcome, variant.kind)
    const attempt: AlternateAttempt = { variant: variant.variant, url: variant.url, kind: variant.kind, outcome, valid }
    alternate.attempts.push(attempt)
    if (valid) {
      alternate.hit = attempt
      alternate.title = title
      break
    }
  }

  // 9. The rest of the sample.
  while (index < queue.length) await fetchPage(queue[index++])

  const facts: SiteFacts = {
    docsRoot,
    robots: { rules: robots, found: robotsState.kind === 'ok' },
    pages,
    llms,
    llmsFull,
    sitemap: sitemapFacts,
    wellKnown,
    rootLinkHeaderMcp,
    alternate,
  }
  return {
    ok: true,
    facts,
    sample: { source, sitemapUrlCount: eligible.length, pages: sampledPages, droppedForBudget },
    rootHeaders: root.headers,
    rootFinalUrl: root.finalUrl,
  }
}
