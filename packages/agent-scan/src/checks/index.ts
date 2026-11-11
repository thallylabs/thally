/**
 * Check registry. Every methodology check id maps to exactly one evaluator;
 * the registry refuses to load if the two sets differ, so a check without
 * code, or code without a published rule, cannot ship.
 */

import { methodology } from '../methodology/methodology.js'
import type { SiteFacts } from '../facts.js'
import type { CheckResult, NotApplicableReason } from '../types.js'
import { agentManifest, llmsFullTxt, llmsTxt, robotsAiAgents, sitemap } from './discovery.js'
import { canonical, dates, lang, titleDescription } from './identity.js'
import { description, title } from './parity.js'
import { alternate, serverRendered, statusHealth } from './retrieval.js'
import { headingOrder, jsonLd, singleH1 } from './structure.js'
import { correctionPath, ownership } from './trust.js'
import type { Evaluator } from './shared.js'

/** Evaluators keyed by methodology check id. */
export const evaluators: Readonly<Record<string, Evaluator>> = {
  'discovery.llms_txt': llmsTxt,
  'discovery.llms_full_txt': llmsFullTxt,
  'discovery.sitemap': sitemap,
  'discovery.robots_ai_agents': robotsAiAgents,
  'discovery.agent_manifest': agentManifest,
  'identity.canonical': canonical,
  'identity.lang': lang,
  'identity.title_description': titleDescription,
  'identity.dates': dates,
  'structure.single_h1': singleH1,
  'structure.heading_order': headingOrder,
  'structure.json_ld': jsonLd,
  'retrieval.server_rendered': serverRendered,
  'retrieval.alternate': alternate,
  'retrieval.status_health': statusHealth,
  'trust.ownership': ownership,
  'trust.correction_path': correctionPath,
  'parity.title': title,
  'parity.description': description,
}

const specIds = methodology.checks.map((check) => check.id).sort()
const codeIds = Object.keys(evaluators).sort()
if (specIds.join('\n') !== codeIds.join('\n')) {
  throw new Error('agent-scan: check evaluators do not match the methodology check ids')
}

/** Evaluate every methodology check, in methodology order. */
export function evaluateChecks(facts: SiteFacts): CheckResult[] {
  return methodology.checks.map((spec) => {
    const outcome = evaluators[spec.id](facts)
    return { id: spec.id, category: spec.category, scored: spec.scored, ...outcome }
  })
}

/** Every check as not applicable, for sites that could not be scanned. */
export function unscannedChecks(reason: NotApplicableReason): CheckResult[] {
  return methodology.checks.map((spec) => ({
    id: spec.id,
    category: spec.category,
    scored: spec.scored,
    status: 'not_applicable',
    value: null,
    notApplicableReason: reason,
    evidence: [],
    detail: 'Site was not scanned.',
  }))
}
