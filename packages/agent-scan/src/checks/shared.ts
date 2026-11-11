/**
 * Building blocks for check evaluators. An evaluator returns the outcome
 * fields; the registry adds id, category and `scored` from the methodology.
 */

import type { PageFacts } from '../html.js'
import type { PageRecord, SiteFacts } from '../facts.js'
import type { CheckResult, NotApplicableReason } from '../types.js'

/** What an evaluator decides; identity fields come from the methodology. */
export type CheckOutcome = Pick<CheckResult, 'status' | 'value' | 'evidence' | 'detail'> &
  Partial<Pick<CheckResult, 'pages' | 'notApplicableReason'>>

/** A pure check evaluator. */
export type Evaluator = (facts: SiteFacts) => CheckOutcome

const MAX_EVIDENCE = 10

const EMPTY_DETAIL: Partial<Record<NotApplicableReason, string>> = {
  no_html_pages: 'No HTML pages to evaluate.',
  budget: 'No sampled page was attempted.',
  no_comparable_pages: 'No sampled page has both a meta description and a JSON-LD description.',
}

/** A binary pass/fail outcome. */
export function binary(passed: boolean, evidence: string[], detail: string): CheckOutcome {
  return { status: passed ? 'pass' : 'fail', value: passed ? 1 : 0, evidence: evidence.slice(0, MAX_EVIDENCE), detail }
}

/** A not-applicable outcome. */
export function notApplicable(reason: NotApplicableReason, detail: string, evidence: string[] = []): CheckOutcome {
  return { status: 'not_applicable', value: null, notApplicableReason: reason, evidence: evidence.slice(0, MAX_EVIDENCE), detail }
}

/** HTML pages in sample order. */
export function htmlPages(facts: SiteFacts): Array<PageRecord & { html: PageFacts }> {
  return facts.pages.filter((page): page is PageRecord & { html: PageFacts } => page.html !== null)
}

/**
 * A page-rate outcome over `pages`: value is passed / applicable, evidence
 * lists failing pages first, then passing pages, each in sample order.
 */
export function pageRate(
  pages: PageRecord[],
  passes: (page: PageRecord) => boolean,
  noun: string,
  emptyReason: NotApplicableReason = 'no_html_pages',
): CheckOutcome {
  if (pages.length === 0) return notApplicable(emptyReason, EMPTY_DETAIL[emptyReason] ?? 'No pages to evaluate.')
  const failing: string[] = []
  const passing: string[] = []
  for (const page of pages) (passes(page) ? passing : failing).push(page.outcome.finalUrl || page.url)
  const value = passing.length / pages.length
  return {
    status: value === 1 ? 'pass' : 'fail',
    value,
    pages: { passed: passing.length, applicable: pages.length },
    evidence: [...failing, ...passing].slice(0, MAX_EVIDENCE),
    detail: `${passing.length}/${pages.length} pages ${noun}.`,
  }
}
