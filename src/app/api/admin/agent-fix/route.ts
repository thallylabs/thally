import { NextResponse, type NextRequest } from 'next/server'
import { requireCapabilityFromRequest } from '@/lib/auth/rbac'
import { getCloud } from '@/lib/cloud-bridge'

export const runtime = 'nodejs'

/**
 * Dispatch the docs agent to open a PR fixing a readiness subscore — auth
 * shell; the dispatch pipeline lives in the cloud tier (Track).
 */
export async function POST(request: NextRequest) {
  const session = await requireCapabilityFromRequest(request, 'run_agent')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const track = getCloud()?.track
  if (!track) return NextResponse.json({ error: 'track_unavailable' }, { status: 404 })
  return track.handleAgentFix(request, session.email !== 'break-glass' ? session.email : undefined)
}
