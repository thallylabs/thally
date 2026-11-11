/** Parity checks: machine-readable representations agree with the HTML. */

import type { SiteFacts } from '../facts.js'
import { normalizeForParity } from '../text.js'
import { binary, htmlPages, notApplicable, pageRate, type CheckOutcome } from './shared.js'

/** `parity.title` */
export function title(facts: SiteFacts): CheckOutcome {
  const { hit, title: altTitle, probePage } = facts.alternate
  if (!hit) return notApplicable('no_alternate', 'No alternate representation to compare.')
  const page = facts.pages.find((record) => record.url === probePage || record.outcome.finalUrl === probePage)
  const html = page?.html
  const alt = altTitle ? normalizeForParity(altTitle) : ''
  if (!alt || !html) return binary(false, [hit.url, probePage], 'Alternate has no title to compare.')
  const passed = alt === normalizeForParity(html.firstH1) || normalizeForParity(html.title).startsWith(alt)
  return binary(passed, [hit.url, probePage], passed ? 'Alternate title matches the HTML.' : 'Alternate title differs from the HTML.')
}

/** `parity.description` */
export function description(facts: SiteFacts): CheckOutcome {
  const comparable = htmlPages(facts).filter((page) => page.html.metaDescription !== '' && page.html.jsonLd.description !== null)
  return pageRate(
    comparable,
    (page) => normalizeForParity(page.html!.metaDescription) === normalizeForParity(page.html!.jsonLd.description ?? ''),
    'have matching meta and JSON-LD descriptions',
    'no_comparable_pages',
  )
}
