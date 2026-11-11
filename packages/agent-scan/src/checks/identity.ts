/** Identity checks: canonical URL, language, title and description, modification dates. */

import type { SiteFacts } from '../facts.js'
import { sameUrl } from '../url.js'
import { htmlPages, pageRate, type CheckOutcome } from './shared.js'

/** `identity.canonical` */
export function canonical(facts: SiteFacts): CheckOutcome {
  return pageRate(htmlPages(facts), (page) => {
    const html = page.html!
    return html.canonicals.length === 1 && html.canonicals[0] !== '' && sameUrl(html.canonicals[0], html.finalUrl)
  }, 'have a single self-referencing canonical')
}

/** `identity.lang` */
export function lang(facts: SiteFacts): CheckOutcome {
  return pageRate(htmlPages(facts), (page) => page.html!.lang !== '', 'declare <html lang>')
}

/** `identity.title_description` */
export function titleDescription(facts: SiteFacts): CheckOutcome {
  return pageRate(
    htmlPages(facts),
    (page) => page.html!.title !== '' && page.html!.metaDescription !== '',
    'have a title and meta description',
  )
}

/** `identity.dates` */
export function dates(facts: SiteFacts): CheckOutcome {
  return pageRate(
    htmlPages(facts),
    (page) => page.html!.jsonLd.hasDateModified || page.html!.articleModifiedTime || page.html!.timeUpdated,
    'expose a modification date',
  )
}
