import { NextResponse, type NextRequest } from 'next/server'
import { requireCapabilityFromRequest } from '@/lib/auth/rbac'
import { getCloud } from '@/lib/cloud-bridge'
import type { ScmProvider, TrackService } from '@/lib/cloud-bridge/types'

export const runtime = 'nodejs'

/** Providers this route accepts; anything else is a 404, never forwarded. */
const PROVIDERS: Record<ScmProvider, true> = { github: true, gitlab: true }

interface RouteContext {
  params: Promise<{ provider: string }>
}

/**
 * Provider-keyed Thally Track connection — auth shell. Owner-only
 * (manage_team): a connection grants repository access. The implementation
 * lives in the cloud tier behind optional bridge methods; without them these
 * endpoints answer 404 `scm_unavailable` and the admin panel shows setup
 * instructions instead.
 */
async function resolve(
  request: NextRequest,
  context: RouteContext,
): Promise<{ track: TrackService; provider: ScmProvider } | NextResponse> {
  const session = await requireCapabilityFromRequest(request, 'manage_team')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { provider } = await context.params
  if (!Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) {
    return NextResponse.json({ error: 'unknown_provider' }, { status: 404 })
  }
  const track = getCloud()?.track
  if (!track) return NextResponse.json({ error: 'scm_unavailable' }, { status: 404 })
  return { track, provider: provider as ScmProvider }
}

const unavailable = () => NextResponse.json({ error: 'scm_unavailable' }, { status: 404 })

export async function GET(request: NextRequest, context: RouteContext) {
  const resolved = await resolve(request, context)
  if (resolved instanceof NextResponse) return resolved
  const { track, provider } = resolved
  return track.scmConnectionStatus ? track.scmConnectionStatus(provider) : unavailable()
}

export async function POST(request: NextRequest, context: RouteContext) {
  const resolved = await resolve(request, context)
  if (resolved instanceof NextResponse) return resolved
  const { track, provider } = resolved
  return track.scmConnectionBegin ? track.scmConnectionBegin(provider, request) : unavailable()
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const resolved = await resolve(request, context)
  if (resolved instanceof NextResponse) return resolved
  const { track, provider } = resolved
  return track.scmConnectionDisconnect ? track.scmConnectionDisconnect(provider) : unavailable()
}
