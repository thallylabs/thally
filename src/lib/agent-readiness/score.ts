/**
 * Agent Readiness Score, methodology v2.
 *
 * A pure, deterministic function of gathered facts (plus an explicit clock for
 * freshness). Each check measures something an agent experiences when it uses
 * the docs: can it find the right page, fit it in context, follow its links,
 * run its code, and call its API. Checks that do not apply to a site (no API
 * spec, no golden questions, no traffic data) are reported as `skip` and
 * excluded from the weighting, so adopting a feature never lowers the score
 * merely by making a check applicable.
 *
 * Check ids are stable identifiers for history and fix dispatch. v1 ids are
 * kept where the semantics carried over (`metadata`, `discovery`,
 * `structured_data`, `content_quality`, `machine_readability`, `openapi`).
 */

import {
  READINESS_METHODOLOGY_VERSION,
  type AgentReadinessReport,
  type AgentTrafficFacts,
  type OperationFacts,
  type PageFact,
  type ReadinessOffender,
  type ReadinessStatus,
  type RetrievalFacts,
  type SubscoreResult,
} from '@/lib/agent-readiness/types'
import { isIsoDate } from '@/lib/agent-readiness/json-ld'

/** Pages or operations listed per check; `affectedCount` carries the full total. */
export const MAX_OFFENDERS = 50

const THIN_CONTENT_CHARS = 200
const DESCRIPTION_MIN_CHARS = 50
const DESCRIPTION_MAX_CHARS = 300
/** A page this long without any heading cannot be chunked for retrieval. */
const UNSTRUCTURED_TEXT_CHARS = 1_500
/** A single section larger than this is retrieved as one oversized chunk. */
const SECTION_TOKEN_BUDGET = 1_000
/** Pages above this exceed the fetch/context budget of many agent tools. */
const PAGE_TOKEN_BUDGET = 10_000
const PAGE_TOKEN_LIMIT = 25_000
const FRESH_DAYS = 180
const STALE_DAYS = 365
const DAY_MS = 86_400_000

/** Nominal weights of the always-evaluated checks; they sum to 1. */
export const CHECK_WEIGHTS = {
  metadata: 0.12,
  internal_links: 0.12,
  heading_structure: 0.12,
  code_language_tags: 0.1,
  openapi_examples: 0.1,
  structured_data: 0.08,
  page_size: 0.08,
  freshness: 0.07,
  content_quality: 0.06,
  openapi: 0.05,
  discovery: 0.05,
  machine_readability: 0.05,
  /** Optional: only when golden questions are configured. */
  retrieval_eval: 0.15,
  /** Optional: only when observed agent traffic is supplied. */
  agent_success: 0.15,
} as const

type CheckId = keyof typeof CHECK_WEIGHTS

/** A single page's (or operation's) outcome within one check. */
interface Verdict {
  pageId: string
  href: string
  /** 0..1 for this item. */
  score: number
  reason: string
}

interface CheckOutcome {
  /** Undefined → computed from verdicts over `total` items. */
  score?: number
  /** Items the check evaluated (denominator for verdict-based scores). */
  total?: number
  detail: string
  verdicts?: Array<Verdict>
  available?: boolean
}

const LABELS: Record<CheckId, string> = {
  metadata: 'Description quality',
  internal_links: 'Internal links and anchors',
  heading_structure: 'Chunkable structure',
  code_language_tags: 'Code language tags',
  openapi_examples: 'OpenAPI examples',
  structured_data: 'Structured data validity',
  page_size: 'Page size budget',
  freshness: 'Verification freshness',
  content_quality: 'Substantive content',
  openapi: 'OpenAPI coverage',
  discovery: 'Discovery health',
  machine_readability: 'Machine readability',
  retrieval_eval: 'Golden-question retrieval',
  agent_success: 'Observed agent success',
}

/** Server-owned remediation text; never derived from page content. */
const FIX_HINTS: Record<CheckId, string> = {
  metadata:
    'Give every page a unique frontmatter description of 50–300 characters that says what the page answers; do not repeat the title.',
  internal_links:
    'Point each listed link at an existing page path or heading anchor, or add a docs.json redirect for moved pages.',
  heading_structure:
    'Split long pages and sections with descriptive ## and ### headings, and do not skip heading levels.',
  code_language_tags:
    'Add a language to every code fence (```bash, ```json, ```ts); use ```text for plain output.',
  openapi_examples:
    'Add `example` or `examples` to request bodies and to at least one 2xx response for each listed operation.',
  structured_data:
    'Keep titles under 110 characters and write `lastUpdated` as an ISO 8601 date (YYYY-MM-DD).',
  page_size:
    'Split pages above the token budget into focused pages, or move long reference tables to their own page.',
  freshness:
    'Re-verify the listed pages against the product and update their `lastVerified` frontmatter date.',
  content_quality:
    'Expand the listed pages with at least a few sentences of useful guidance, or remove them from the site.',
  openapi:
    'Bind each API page to its operation with `openapi:` frontmatter, or declare it with `api:`.',
  discovery:
    'Add the listed pages to docs.json navigation so llms.txt and the docs index list them.',
  machine_readability:
    'Restore the source file for each listed page so its JSON, Markdown, and JSON-LD projections resolve.',
  retrieval_eval:
    'Name the missed concepts in the expected page\'s title, description, or headings, or fix the `expect` paths in docs.json.',
  agent_success:
    'Inspect failing agent requests in analytics and fix the pages or endpoints they hit.',
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function statusFor(available: boolean, score: number): ReadinessStatus {
  if (!available) return 'skip'
  if (score >= 1) return 'pass'
  return score >= 0.5 ? 'warn' : 'fail'
}

/** Published-report consumers bound these fields; customer-derived values must fit. */
const MAX_PAGE_ID_LENGTH = 240
const MAX_HREF_LENGTH = 2_048
const MAX_REASON_LENGTH = 300

/**
 * Clamp offender identifiers to consumer limits while keeping `pageId`
 * unique within the check (dashboards key rows on it).
 */
function clampOffenders(offenders: ReadonlyArray<ReadinessOffender>): Array<ReadinessOffender> {
  const used = new Set<string>()
  return offenders.map((offender, index) => {
    let pageId = truncate(offender.pageId, MAX_PAGE_ID_LENGTH)
    if (used.has(pageId)) pageId = `${truncate(offender.pageId, MAX_PAGE_ID_LENGTH - 8)}~${index}`
    used.add(pageId)
    return {
      pageId,
      href: offender.href.slice(0, MAX_HREF_LENGTH),
      reason: truncate(offender.reason, MAX_REASON_LENGTH),
    }
  })
}

/**
 * Bound one check's offender list for publication: drop unlisted pages when
 * redacting (they still count in `affectedCount` and the score, but are never
 * named), then cap and clamp. Runs after every check so no check can forget.
 */
function boundOffenders(sub: SubscoreResult, unlistedHrefs: ReadonlySet<string> | null): SubscoreResult {
  const listed = unlistedHrefs ? sub.offenders.filter((offender) => !unlistedHrefs.has(offender.href)) : sub.offenders
  const redacted = sub.offenders.length - listed.length
  const detail = redacted
    ? `${sub.detail}; ${plural(redacted, 'hidden or noindex page')} excluded from this list`
    : sub.detail
  return {
    ...sub,
    detail: truncate(detail, 500),
    offenders: clampOffenders(listed.slice(0, MAX_OFFENDERS)),
  }
}

function finish(id: CheckId, outcome: CheckOutcome): SubscoreResult {
  const available = outcome.available ?? true
  // A skipped check never lists offenders: older dashboards count every
  // listed page as needing attention regardless of the check's status.
  const verdicts = available ? (outcome.verdicts ?? []).filter((verdict) => verdict.score < 1) : []
  const total = outcome.total ?? 0
  const penalty = verdicts.reduce((sum, verdict) => sum + (1 - clamp01(verdict.score)), 0)
  const computed = total === 0 ? 1 : 1 - penalty / total
  // Unavailable checks report 1 so consumers that predate `status` count them
  // as passing rather than needing attention; they carry no weight.
  const score = available ? clamp01(outcome.score ?? computed) : 1
  // Full, worst-first list; `boundOffenders` redacts, caps, and clamps it.
  const offenders: Array<ReadinessOffender> = [...verdicts]
    .sort((a, b) => a.score - b.score || a.href.localeCompare(b.href) || a.pageId.localeCompare(b.pageId))
    .map(({ pageId, href, reason }) => ({ pageId, href, reason }))

  return {
    id,
    label: LABELS[id],
    weight: CHECK_WEIGHTS[id],
    score,
    available,
    detail: outcome.detail,
    offenders,
    status: statusFor(available, score),
    fixHint: FIX_HINTS[id],
    affectedCount: verdicts.length,
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** Per-page verdict; null when the page passes. */
type PageJudge = (page: PageFact) => { score: number; reason: string } | null

function perPage(pages: ReadonlyArray<PageFact>, judge: PageJudge): Array<Verdict> {
  const verdicts: Array<Verdict> = []
  for (const page of pages) {
    const result = judge(page)
    if (result) verdicts.push({ pageId: page.pageId, href: page.href, ...result })
  }
  return verdicts
}

function passingDetail(pages: ReadonlyArray<PageFact>, verdicts: ReadonlyArray<Verdict>, what: string): string {
  return `${pages.length - verdicts.length}/${pages.length} pages ${what}`
}

// ---------------------------------------------------------------------------
// Page checks
// ---------------------------------------------------------------------------

function normalizeDescription(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function checkMetadata(pages: ReadonlyArray<PageFact>): SubscoreResult {
  const counts = new Map<string, number>()
  for (const page of pages) {
    const key = normalizeDescription(page.description)
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const verdicts = perPage(pages, (page) => {
    const description = page.description.trim()
    if (!description) return { score: 0, reason: 'missing description' }
    const issues: Array<string> = []
    if (description.length < DESCRIPTION_MIN_CHARS) issues.push(`description is ${description.length} characters (under ${DESCRIPTION_MIN_CHARS})`)
    if (description.length > DESCRIPTION_MAX_CHARS) issues.push(`description is ${description.length} characters (over ${DESCRIPTION_MAX_CHARS})`)
    if ((counts.get(normalizeDescription(description)) ?? 0) > 1) issues.push('description duplicates another page')
    if (normalizeDescription(description) === normalizeDescription(page.title)) issues.push('description repeats the title')
    return issues.length ? { score: 0.5, reason: issues.join('; ') } : null
  })
  return finish('metadata', {
    total: pages.length,
    verdicts,
    detail: passingDetail(pages, verdicts, 'have a unique, specific description'),
  })
}

function checkInternalLinks(pages: ReadonlyArray<PageFact>): SubscoreResult {
  let brokenPages = 0
  let brokenAnchors = 0
  const verdicts = perPage(pages, (page) => {
    const broken = page.brokenLinks ?? []
    if (broken.length === 0) return null
    const missingPages = broken.filter((link) => link.kind === 'page')
    const missingAnchors = broken.filter((link) => link.kind === 'anchor')
    brokenPages += missingPages.length
    brokenAnchors += missingAnchors.length
    const parts: Array<string> = []
    if (missingPages.length) parts.push(`${plural(missingPages.length, 'broken link')}: ${missingPages.map((link) => link.target).join(', ')}`)
    if (missingAnchors.length) parts.push(`${plural(missingAnchors.length, 'missing anchor')}: ${missingAnchors.map((link) => link.target).join(', ')}`)
    // A dead page costs an agent a fetch; a missing anchor only loses position.
    return { score: missingPages.length ? 0 : 0.5, reason: parts.join('; ') }
  })
  return finish('internal_links', {
    total: pages.length,
    verdicts,
    detail: verdicts.length
      ? `${plural(brokenPages, 'broken internal link')} and ${plural(brokenAnchors, 'missing anchor')} across ${plural(verdicts.length, 'page')}`
      : `All internal links and anchors resolve across ${plural(pages.length, 'page')}`,
  })
}

function checkHeadingStructure(pages: ReadonlyArray<PageFact>): SubscoreResult {
  const verdicts = perPage(pages, (page) => {
    if (!page.hasContentDoc) return null
    if (page.headingsCount === 0 && page.textLength >= UNSTRUCTURED_TEXT_CHARS) {
      return { score: 0, reason: `${page.textLength} characters with no headings` }
    }
    const issues: Array<string> = []
    const section = page.largestSection
    if (section && section.approxTokens > SECTION_TOKEN_BUDGET) {
      issues.push(`section "${truncate(section.title, 80)}" is ~${section.approxTokens} tokens (over ${SECTION_TOKEN_BUDGET})`)
    }
    const depths = page.headingDepths ?? []
    for (let i = 1; i < depths.length; i += 1) {
      if (depths[i] > depths[i - 1] + 1) {
        issues.push(`heading level jumps from h${depths[i - 1]} to h${depths[i]}`)
        break
      }
    }
    return issues.length ? { score: 0.5, reason: issues.join('; ') } : null
  })
  return finish('heading_structure', {
    total: pages.length,
    verdicts,
    detail: passingDetail(pages, verdicts, 'split into retrievable, well-nested sections'),
  })
}

function checkCodeLanguageTags(pages: ReadonlyArray<PageFact>): SubscoreResult {
  const withCode = pages.filter((page) => page.codeBlocksCount > 0)
  const measurable = withCode.filter((page) => page.untaggedCodeBlocks !== undefined)
  if (measurable.length === 0) {
    return finish('code_language_tags', {
      available: false,
      detail: withCode.length
        ? 'The installed content engine does not report code fence languages; update @thallylabs/core'
        : 'No code blocks to check',
    })
  }
  const totalBlocks = measurable.reduce((sum, page) => sum + page.codeBlocksCount, 0)
  const untagged = measurable.reduce((sum, page) => sum + (page.untaggedCodeBlocks ?? 0), 0)
  const verdicts = perPage(measurable, (page) => {
    const missing = page.untaggedCodeBlocks ?? 0
    if (missing === 0) return null
    return {
      score: 1 - missing / page.codeBlocksCount,
      reason: `${missing} of ${plural(page.codeBlocksCount, 'code block')} have no language tag`,
    }
  })
  return finish('code_language_tags', {
    // Block-weighted: one untagged fence among fifty is a small problem.
    score: 1 - untagged / totalBlocks,
    verdicts,
    detail: `${totalBlocks - untagged}/${totalBlocks} code blocks declare a language`,
  })
}

function checkStructuredData(pages: ReadonlyArray<PageFact>): SubscoreResult {
  const verdicts = perPage(pages, (page) => {
    const issues = page.jsonLdIssues ?? []
    if (issues.length === 0) return null
    return {
      score: issues.some((issue) => issue.severity === 'fail') ? 0 : 0.5,
      reason: issues.map((issue) => issue.message).join('; '),
    }
  })
  return finish('structured_data', {
    total: pages.length,
    verdicts,
    detail: passingDetail(pages, verdicts, 'emit valid schema.org JSON-LD'),
  })
}

function checkPageSize(pages: ReadonlyArray<PageFact>): SubscoreResult {
  const verdicts = perPage(pages, (page) => {
    const tokens = page.approxTokens ?? 0
    if (tokens > PAGE_TOKEN_LIMIT) return { score: 0, reason: `~${tokens} tokens (over the ${PAGE_TOKEN_LIMIT} limit)` }
    if (tokens > PAGE_TOKEN_BUDGET) return { score: 0.5, reason: `~${tokens} tokens (over the ${PAGE_TOKEN_BUDGET} budget)` }
    return null
  })
  return finish('page_size', {
    total: pages.length,
    verdicts,
    detail: passingDetail(pages, verdicts, `fit a ${PAGE_TOKEN_BUDGET}-token agent context budget`),
  })
}

function checkFreshness(pages: ReadonlyArray<PageFact>, now: Date): SubscoreResult {
  const declared = pages.filter((page) => page.lastVerified)
  if (declared.length === 0) {
    return finish('freshness', {
      available: false,
      detail: 'No page declares `lastVerified`; add it to pages you have checked against the product',
    })
  }
  const verdicts = perPage(declared, (page) => {
    const value = page.lastVerified ?? ''
    const time = isIsoDate(value) ? Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value.replace(' ', 'T')) : Number.NaN
    if (Number.isNaN(time) || time > now.getTime() + DAY_MS) {
      return { score: 0, reason: `lastVerified "${truncate(value, 40)}" is not a valid past ISO date` }
    }
    const ageDays = Math.floor((now.getTime() - time) / DAY_MS)
    if (ageDays > STALE_DAYS) return { score: 0, reason: `last verified ${ageDays} days ago` }
    if (ageDays > FRESH_DAYS) return { score: 0.5, reason: `last verified ${ageDays} days ago` }
    return null
  })
  // Coverage is reported but not scored, so verifying one more page can only
  // help: unverified pages are neither stale nor fresh.
  return finish('freshness', {
    total: declared.length,
    verdicts,
    detail: `${declared.length - verdicts.length}/${declared.length} verified pages checked within ${FRESH_DAYS} days; ${declared.length}/${pages.length} pages declare lastVerified`,
  })
}

function checkContentQuality(pages: ReadonlyArray<PageFact>): SubscoreResult {
  const verdicts = perPage(pages, (page) => {
    if (!page.hasContentDoc) return null
    const length = page.contentLength ?? page.textLength
    return length < THIN_CONTENT_CHARS ? { score: 0, reason: `thin content (${length} characters)` } : null
  })
  return finish('content_quality', {
    total: pages.length,
    verdicts,
    detail: passingDetail(pages, verdicts, `have at least ${THIN_CONTENT_CHARS} characters of substance`),
  })
}

function checkOpenApiCoverage(pages: ReadonlyArray<PageFact>): SubscoreResult {
  const apiPages = pages.filter((page) => page.isApi)
  if (apiPages.length === 0) {
    return finish('openapi', { available: false, detail: 'No API pages to cover' })
  }
  const verdicts = perPage(apiPages, (page) =>
    page.hasOpenApiSpec || page.hasManualOperation ? null : { score: 0, reason: 'API page without an OpenAPI operation' },
  )
  return finish('openapi', {
    total: apiPages.length,
    verdicts,
    detail: `${apiPages.length - verdicts.length}/${apiPages.length} API pages map to an OpenAPI operation or declare their own`,
  })
}

function checkDiscovery(pages: ReadonlyArray<PageFact>): SubscoreResult {
  // Hidden and noindex pages are withheld on purpose; missing from navigation
  // is their intended state, not a discoverability defect.
  const listed = pages.filter((page) => !page.unlisted)
  const verdicts = perPage(listed, (page) =>
    page.inNav ? null : { score: 0, reason: 'not in navigation, llms.txt, or the docs index' },
  )
  return finish('discovery', {
    total: listed.length,
    verdicts,
    detail: passingDetail(listed, verdicts, 'are listed in navigation and llms.txt'),
  })
}

function checkMachineReadability(pages: ReadonlyArray<PageFact>): SubscoreResult {
  const verdicts = perPage(pages, (page) =>
    page.hasContentDoc ? null : { score: 0, reason: 'no resolvable source — cannot serve JSON / Markdown / ld+json' },
  )
  return finish('machine_readability', {
    total: pages.length,
    verdicts,
    detail: passingDetail(pages, verdicts, 'resolve as JSON, Markdown, and JSON-LD'),
  })
}

// ---------------------------------------------------------------------------
// Site checks
// ---------------------------------------------------------------------------

function checkOpenApiExamples(facts: OperationFacts | null | undefined): SubscoreResult {
  if (!facts) return finish('openapi_examples', { available: false, detail: 'No OpenAPI specification configured' })
  if (facts.error) return finish('openapi_examples', { available: false, detail: facts.error })
  if (facts.operations.length === 0) {
    return finish('openapi_examples', { available: false, detail: 'No published OpenAPI operations' })
  }
  const verdicts: Array<Verdict> = []
  for (const operation of facts.operations) {
    const missing: Array<string> = []
    if (operation.hasRequestBody && !operation.hasRequestExample) missing.push('request body example')
    if (operation.hasSuccessContent && !operation.hasResponseExample) missing.push('2xx response example')
    const required = Number(operation.hasRequestBody) + Number(operation.hasSuccessContent)
    if (missing.length && required > 0) {
      verdicts.push({
        pageId: operation.key,
        href: operation.href,
        score: 1 - missing.length / required,
        reason: `${truncate(operation.title, 80)}: missing ${missing.join(' and ')}`,
      })
    }
  }
  return finish('openapi_examples', {
    total: facts.operations.length,
    verdicts,
    detail: `${facts.operations.length - verdicts.length}/${facts.operations.length} operations have request and response examples`,
  })
}

function checkRetrieval(facts: RetrievalFacts | null | undefined): SubscoreResult {
  if (!facts) {
    return finish('retrieval_eval', {
      available: false,
      detail: 'No golden questions configured (docs.json `readiness.goldenQuestions`)',
    })
  }
  if (facts.error) return finish('retrieval_eval', { available: false, detail: facts.error })

  // A question whose expected pages are all excluded from search can never
  // hit; that is a configuration error, reported but not scored.
  const scorable = facts.results.filter((result) => result.unsearchable.length < result.expected.length)
  const misconfigured = facts.results.length - scorable.length
  const byPage = new Map<string, Array<string>>()
  for (const result of facts.results) {
    const isMisconfigured = result.unsearchable.length >= result.expected.length
    if (result.hit && !isMisconfigured) continue
    const page = result.expected[0]
    const note = isMisconfigured
      ? `"${truncate(result.question, 80)}" expects a page that is not in the search index`
      : `"${truncate(result.question, 80)}" not in top ${facts.k}`
    byPage.set(page, [...(byPage.get(page) ?? []), note])
  }
  const hits = scorable.filter((result) => result.hit).length
  const verdicts: Array<Verdict> = [...byPage].map(([href, notes]) => ({
    pageId: href,
    href,
    score: 0,
    reason: notes.join('; '),
  }))
  if (scorable.length === 0) {
    return finish('retrieval_eval', {
      available: false,
      detail: `None of the ${plural(facts.results.length, 'golden question')} expect a page in the search index; check their \`expect\` paths`,
    })
  }
  return finish('retrieval_eval', {
    score: hits / scorable.length,
    verdicts,
    detail:
      `${hits}/${scorable.length} golden questions retrieve an expected page in the top ${facts.k} (hit@${facts.k})` +
      (misconfigured ? `; ${misconfigured} expect only unsearchable pages` : ''),
  })
}

function checkAgentSuccess(traffic: AgentTrafficFacts): SubscoreResult {
  const { agentFetches, agentErrors } = traffic
  const successRate = clamp01((agentFetches - agentErrors) / agentFetches)
  return finish('agent_success', {
    score: successRate,
    detail: `${agentFetches - agentErrors}/${agentFetches} observed agent fetches succeeded`,
  })
}

function gradeFor(score: number): AgentReadinessReport['grade'] {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

export interface ScoreOptions {
  /** Observed agent traffic (supplied by an analytics provider). */
  traffic?: AgentTrafficFacts
  /** Published OpenAPI operations; omitted or null skips example coverage. */
  operations?: OperationFacts | null
  /** Golden-question results; omitted or null skips the retrieval eval. */
  retrieval?: RetrievalFacts | null
  /** Clock for freshness; defaults to now. Pass it for reproducible reports. */
  now?: Date
  /**
   * Public projection: never name unlisted pages (`PageFact.unlisted`) in
   * offender lists. They still count toward scores and `affectedCount`. The
   * published API and MCP report set this; the local CLI does not.
   */
  redactUnlistedPages?: boolean
}

/**
 * Compute a deterministic, explainable 0–100 Agent Readiness Score. Weights
 * are renormalized over available checks, so a check that does not apply to
 * this site neither helps nor hurts.
 */
export function scoreAgentReadiness(pages: Array<PageFact>, options: ScoreOptions = {}): AgentReadinessReport {
  const now = options.now ?? new Date()
  const subscores: Array<SubscoreResult> = [
    checkMetadata(pages),
    checkInternalLinks(pages),
    checkHeadingStructure(pages),
    checkCodeLanguageTags(pages),
    checkOpenApiExamples(options.operations),
    checkStructuredData(pages),
    checkPageSize(pages),
    checkFreshness(pages, now),
    checkContentQuality(pages),
    checkOpenApiCoverage(pages),
    checkDiscovery(pages),
    checkMachineReadability(pages),
    checkRetrieval(options.retrieval),
  ]
  if (options.traffic && options.traffic.agentFetches > 0) {
    subscores.push(checkAgentSuccess(options.traffic))
  }
  const unlistedHrefs = options.redactUnlistedPages
    ? new Set(pages.filter((page) => page.unlisted).map((page) => page.href))
    : null
  const bounded = subscores.map((sub) => boundOffenders(sub, unlistedHrefs))

  const scored = bounded.filter((sub) => sub.available)
  const totalWeight = scored.reduce((sum, sub) => sum + sub.weight, 0)
  const weighted = scored.reduce((sum, sub) => sum + sub.score * sub.weight, 0)
  const score = totalWeight === 0 ? 100 : Math.round((weighted / totalWeight) * 100)

  return {
    version: READINESS_METHODOLOGY_VERSION,
    score,
    grade: gradeFor(score),
    totalPages: pages.length,
    subscores: bounded,
  }
}
