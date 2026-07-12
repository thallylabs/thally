import { NextResponse, type NextRequest } from 'next/server'
import { requireCapabilityFromRequest } from '@/lib/auth/rbac'
import { getCloud } from '@/lib/cloud-bridge'

export const runtime = 'nodejs'

/**
 * "Connect GitHub" (Thally Track GitHub App) — auth shell. Owner-only
 * (manage_team): connecting an app grants repo-wide write access. The flow
 * itself lives in the cloud tier; without it these endpoints 404 and the
 * admin panel shows the locked Track state.
 */
export async function GET(request: NextRequest) {
  const session = await requireCapabilityFromRequest(request, 'manage_team')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const track = getCloud()?.track
  if (!track) return NextResponse.json({ error: 'track_unavailable' }, { status: 404 })
  return track.githubAppStatus()
}

export async function POST(request: NextRequest) {
  const session = await requireCapabilityFromRequest(request, 'manage_team')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const track = getCloud()?.track
  if (!track) return NextResponse.json({ error: 'track_unavailable' }, { status: 404 })
  return track.githubAppBegin(request)
}

export async function DELETE(request: NextRequest) {
  const session = await requireCapabilityFromRequest(request, 'manage_team')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const track = getCloud()?.track
  if (!track) return NextResponse.json({ error: 'track_unavailable' }, { status: 404 })
  return track.githubAppDisconnect()
}
