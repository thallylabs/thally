import { NextResponse, type NextRequest } from 'next/server'
import { requireCapabilityFromRequest } from '@/lib/auth/rbac'
import { getAdminSettings, updateAdminSettings } from '@/lib/admin/settings'
import { buildAppManifest, signManifestState } from '@/lib/track/github-app'

export const runtime = 'nodejs'

/**
 * "Connect GitHub" — start + status + disconnect for the Dox Track GitHub App.
 *
 * GET  → connection status (redacted: slug/id only, never the key or secret).
 * POST → begin the manifest flow: returns the manifest + a signed CSRF state +
 *        the GitHub `/settings/apps/new` target. The admin panel then auto-submits
 *        a form POST to GitHub with the manifest (GitHub's documented create UX).
 * DELETE → disconnect (clears the stored app + credentials).
 *
 * Owner-only (manage_team) — connecting an app grants repo-wide write access.
 */
export async function GET(request: NextRequest) {
  const session = await requireCapabilityFromRequest(request, 'manage_team')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const app = (await getAdminSettings()).githubApp
  return NextResponse.json({
    connected: Boolean(app),
    installed: Boolean(app?.installationId),
    slug: app?.slug ?? null,
    htmlUrl: app?.htmlUrl ?? null,
    installationId: app?.installationId ?? null,
  })
}

export async function POST(request: NextRequest) {
  const session = await requireCapabilityFromRequest(request, 'manage_team')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const state = signManifestState()
  if (!state) {
    return NextResponse.json(
      { error: 'Set DOX_AUTH_SECRET (≥16 chars) before connecting a GitHub App — it secures the flow and encrypts the key.' },
      { status: 400 },
    )
  }

  let body: { org?: string; appName?: string } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // no body is fine — personal-account app with the default name
  }

  const org = typeof body.org === 'string' ? body.org.trim().replace(/[^A-Za-z0-9-]/g, '') : ''
  const manifest = buildAppManifest({ appName: body.appName })
  // Personal account vs. an organization the user administers.
  const githubUrl = org
    ? `https://github.com/organizations/${org}/settings/apps/new`
    : 'https://github.com/settings/apps/new'

  return NextResponse.json({ manifest, state, githubUrl })
}

export async function DELETE(request: NextRequest) {
  const session = await requireCapabilityFromRequest(request, 'manage_team')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await updateAdminSettings({ githubApp: null })
  return NextResponse.json({ connected: false })
}
