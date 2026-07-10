import { NextResponse, type NextRequest } from 'next/server'
import { requireCapabilityFromRequest } from '@/lib/auth/rbac'
import { computeAgentReadiness } from '@/lib/agent-readiness'
import {
  buildReadinessFixInstruction,
  dispatchDocsAgent,
} from '@/lib/admin/dispatch-agent'

export const runtime = 'nodejs'

/**
 * Dispatch the docs agent to open a PR fixing a readiness subscore.
 * Body: `{ subscoreId: string }`
 *
 * Relays `repository_dispatch` (event: dox-document) to the configured docs
 * repo — same path Track uses — so the existing dox-agent.yml workflow runs.
 */
export async function POST(request: NextRequest) {
  const session = await requireCapabilityFromRequest(request, 'run_agent')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const subscoreId =
    body && typeof body === 'object' && typeof (body as { subscoreId?: unknown }).subscoreId === 'string'
      ? (body as { subscoreId: string }).subscoreId.trim()
      : ''
  if (!subscoreId) {
    return NextResponse.json({ error: 'subscoreId is required' }, { status: 400 })
  }

  const report = computeAgentReadiness()
  const sub = report.subscores.find((s) => s.id === subscoreId)
  if (!sub) {
    return NextResponse.json({ error: 'Unknown readiness check' }, { status: 404 })
  }
  if (sub.offenders.length === 0) {
    return NextResponse.json({ error: 'This check has no fixable offenders' }, { status: 400 })
  }

  const result = await dispatchDocsAgent({
    instruction: buildReadinessFixInstruction(sub),
    requester: session.email !== 'break-glass' ? session.email : undefined,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    )
  }

  return NextResponse.json(
    {
      ok: true,
      dispatched: true,
      docsRepo: result.docsRepo,
      check: sub.label,
      message: `Docs agent dispatched on ${result.docsRepo}. A fix PR will appear in Admin → Docs tasks once the workflow finishes.`,
    },
    { status: 202 },
  )
}
