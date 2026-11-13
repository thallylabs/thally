/** Structure checks: a single H1, heading order and valid JSON-LD. */

import type { SiteFacts } from '../facts.js'
import { htmlPages, pageRate, type CheckOutcome } from './shared.js'

/** True when no heading is more than one level deeper than the one before it. */
export function headingsInOrder(levels: number[]): boolean {
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) return false
  }
  return true
}

/** `structure.single_h1` */
export function singleH1(facts: SiteFacts): CheckOutcome {
  return pageRate(htmlPages(facts), (page) => page.html!.h1Count === 1, 'have exactly one <h1>')
}

/** `structure.heading_order` */
export function headingOrder(facts: SiteFacts): CheckOutcome {
  return pageRate(htmlPages(facts), (page) => headingsInOrder(page.html!.headingLevels), 'have no skipped heading levels')
}

/** `structure.json_ld` */
export function jsonLd(facts: SiteFacts): CheckOutcome {
  return pageRate(htmlPages(facts), (page) => page.html!.jsonLd.scripts > 0 && page.html!.jsonLd.allValid, 'have valid typed JSON-LD')
}
