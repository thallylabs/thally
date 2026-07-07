import { gatherPageFacts } from '@/lib/agent-readiness/gather'
import { scoreAgentReadiness, type ScoreOptions } from '@/lib/agent-readiness/score'
import type { AgentReadinessReport } from '@/lib/agent-readiness/types'

/**
 * Compute the Agent Readiness Score for the current site. Same core lib used by
 * the API/dashboard and the CLI, so the score is identical everywhere.
 */
export function computeAgentReadiness(options: ScoreOptions = {}): AgentReadinessReport {
  return scoreAgentReadiness(gatherPageFacts(), options)
}

export { scoreAgentReadiness } from '@/lib/agent-readiness/score'
export { gatherPageFacts } from '@/lib/agent-readiness/gather'
export type {
  AgentReadinessReport,
  SubscoreResult,
  PageFact,
  ReadinessOffender,
  AgentTrafficFacts,
} from '@/lib/agent-readiness/types'
