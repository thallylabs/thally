/** Retrieval checks: server-rendered content, machine-readable alternates and status health. */

import { methodology } from '../methodology/methodology.js'
import type { SiteFacts } from '../facts.js'
import { binary, htmlPages, notApplicable, pageRate, type CheckOutcome } from './shared.js'

/** `retrieval.server_rendered` */
export function serverRendered(facts: SiteFacts): CheckOutcome {
  const min = methodology.probes.serverRenderedMinChars
  return pageRate(htmlPages(facts), (page) => page.html!.mainTextLength >= min, `render at least ${min} characters of main text without JavaScript`)
}

/** `retrieval.alternate` */
export function alternate(facts: SiteFacts): CheckOutcome {
  const { attempts, hit, probePage } = facts.alternate
  if (hit) return binary(true, [hit.url], `Alternate ${hit.kind} representation found (${hit.variant}).`)
  const offsite = attempts.filter((attempt) => attempt.skipped === 'offsite')
  const others = attempts.filter((attempt) => attempt.skipped !== 'offsite')
  if (others.length > 0 && others.every((attempt) => attempt.skipped === 'budget')) {
    return notApplicable('budget', 'Alternate probes skipped: request budget exhausted.', [probePage])
  }
  const tried = others.filter((attempt) => attempt.outcome !== null).map((attempt) => attempt.url)
  const detail = offsite.length > 0
    ? `No Markdown or JSON alternate found for the probe page; a declared alternate on another host (${offsite[0].url}) does not count.`
    : 'No Markdown or JSON alternate found for the probe page.'
  return binary(false, [probePage, ...tried, ...offsite.map((attempt) => attempt.url)], detail)
}

/** `retrieval.status_health` */
export function statusHealth(facts: SiteFacts): CheckOutcome {
  const maxRedirects = methodology.probes.maxStatusRedirects
  return pageRate(
    facts.pages,
    (page) => page.outcome.error === null && page.outcome.status === 200 && page.outcome.redirects <= maxRedirects,
    `returned 200 within ${maxRedirects} redirects`,
    'budget',
  )
}
