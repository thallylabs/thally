import { NextResponse, type NextRequest } from 'next/server'
import { requireCapabilityFromRequest } from '@/lib/auth/rbac'
import { getCloud } from '@/lib/cloud-bridge'

export const runtime = 'nodejs'

/**
 * Manifest-flow callback — auth shell (browser redirects carry the owner's
 * admin session cookie, so this stays owner-gated). The CSRF-hardened flow
 * lives in the cloud tier (src/cloud/track/handlers.ts).
 */
export async function GET(request: NextRequest) {
  const session = await requireCapabilityFromRequest(request, 'manage_team')
  if (!session) {
    const url = new URL('/admin/settings', request.url)
    url.searchParams.set('github_app', 'forbidden')
    return NextResponse.redirect(url)
  }
  const track = getCloud()?.track
  if (!track) return NextResponse.json({ error: 'track_unavailable' }, { status: 404 })
  return track.handleGithubAppCallback(request)
}
