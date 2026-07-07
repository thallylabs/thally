import { z } from 'zod'

export const agentReadinessSchema = z.object({
  siteUrl: z
    .string()
    .describe('Base URL of the deployed Dox site (e.g. https://docs.example.com)'),
  minScore: z
    .number()
    .optional()
    .describe('Optional threshold (0-100). If set, the summary flags whether the site passes.'),
})

export type AgentReadinessInput = z.infer<typeof agentReadinessSchema>

interface Offender {
  pageId: string
  href: string
  reason: string
}

interface Subscore {
  id: string
  label: string
  weight: number
  score: number
  available: boolean
  detail: string
  offenders: Array<Offender>
}

interface ReadinessResponse {
  score: number
  grade: string
  totalPages: number
  subscores: Array<Subscore>
}

/**
 * Query the deployed site's Agent Readiness Score — the same deterministic
 * 0-100 report exposed at `/api/agent-readiness` and the `dox check` CLI.
 */
export async function handleAgentReadiness(input: AgentReadinessInput): Promise<string> {
  const { siteUrl, minScore } = input
  const base = siteUrl.replace(/\/$/, '')
  const url = `${base}/api/agent-readiness`

  let response: Response
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } })
  } catch (err) {
    throw new Error(`Failed to reach ${url}: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!response.ok) {
    throw new Error(`Agent readiness request failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as ReadinessResponse

  const lines = [
    `Agent Readiness: ${data.score}/100 (grade ${data.grade}) across ${data.totalPages} pages.`,
  ]

  if (typeof minScore === 'number') {
    lines.push(data.score >= minScore ? `PASS (>= ${minScore})` : `FAIL (< ${minScore})`)
  }

  lines.push('', 'Subscores:')
  for (const sub of data.subscores) {
    const pct = Math.round(sub.score * 100)
    const status = sub.available ? `${pct}%` : 'n/a'
    lines.push(`- ${sub.label} (weight ${sub.weight}): ${status} — ${sub.detail}`)
    for (const offender of sub.offenders.slice(0, 3)) {
      lines.push(`    • ${offender.href}: ${offender.reason}`)
    }
  }

  return lines.join('\n').trimEnd()
}
