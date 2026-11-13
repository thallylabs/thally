/** Trust checks: ownership and a correction path. */

import type { SiteFacts } from '../facts.js'
import { htmlPages, pageRate, type CheckOutcome } from './shared.js'

/** `trust.ownership` */
export function ownership(facts: SiteFacts): CheckOutcome {
  return pageRate(htmlPages(facts), (page) => page.html!.jsonLd.hasOrganization || page.html!.footerOwnership, 'identify an owner')
}

/** `trust.correction_path` */
export function correctionPath(facts: SiteFacts): CheckOutcome {
  return pageRate(htmlPages(facts), (page) => page.html!.correctionLink || page.html!.correctionText, 'offer an edit or feedback path')
}
