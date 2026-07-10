import { NextResponse, type NextRequest } from 'next/server'
import { requireCapabilityFromRequest } from '@/lib/auth/rbac'
import { getAdminSettings, updateAdminSettings } from '@/lib/admin/settings'
import { encryptSecret, decryptSecret } from '@/lib/admin/secrets'
import { exchangeManifestCode, verifyManifestState, signManifestState } from '@/lib/track/github-app'
import { verifyInstallationBelongsToApp } from '@doxlabs/mcp/track'

export const runtime = 'nodejs'

/**
 * Manifest-flow callback. GitHub hits this twice, both as browser redirects that
 * carry the owner's admin session cookie (so it stays owner-gated):
 *
 *   1. After app creation:  ?code=<one-time>&state=<csrf>
 *      → verify state, exchange the code, encrypt + store the app credentials,
 *        then send the user to install the app on their repos.
 *   2. After installation:  ?installation_id=<id>&setup_action=install[&state=<csrf>]
 *      → accept the installation id only when it's provably ours (valid CSRF
 *        state, OR confirmed via the App API to belong to this app).
 *
 * Fail-closed: bad state / unverifiable installation / decrypt/encrypt failure
 * redirects back with an error and NEVER leaks the private key. Never 5xxes.
 */
function redirect(request: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL('/admin/settings', request.url)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const session = await requireCapabilityFromRequest(request, 'manage_team')
  if (!session) return redirect(request, { github_app: 'forbidden' })

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const installationId = url.searchParams.get('installation_id')

  // ---- Phase 2: post-install — attach the installation id ------------------
  // CSRF-hardened: a state-mutating GET must not trust the installation_id from
  // the query alone (SameSite=Lax means a cross-site top-level GET carries the
  // owner's cookie). Accept the id only when it is provably ours — either a valid
  // CSRF state (happy path, when GitHub propagates it) OR confirmed via the App
  // API to belong to this app (robust fallback; an attacker-forged or foreign id
  // fails this and cannot overwrite/DoS the stored installation).
  if (installationId) {
    const app = (await getAdminSettings()).githubApp
    if (!app) return redirect(request, { github_app: 'not_connected' })

    const stateOk = state ? verifyManifestState(state) : false
    let ownershipOk = false
    if (!stateOk) {
      const privateKey = decryptSecret(app.keyEnc)
      if (!privateKey) return redirect(request, { github_app: 'no_auth_secret' })
      ownershipOk = await verifyInstallationBelongsToApp(app.appId, privateKey, installationId).catch(() => false)
    }
    if (!stateOk && !ownershipOk) return redirect(request, { github_app: 'bad_state' })

    await updateAdminSettings({ githubApp: { ...app, installationId } })
    return redirect(request, { github_app: 'connected' })
  }

  // ---- Phase 1: app just created — exchange the code -----------------------
  // CSRF matters here: the one-time `code` exchanges into the app's PRIVATE KEY,
  // so this branch REQUIRES a valid, unexpired, correctly-signed state.
  if (!verifyManifestState(state)) return redirect(request, { github_app: 'bad_state' })
  if (!code) return redirect(request, { github_app: 'missing_code' })

  let conversion
  try {
    conversion = await exchangeManifestCode(code)
  } catch {
    return redirect(request, { github_app: 'exchange_failed' })
  }

  const keyEnc = encryptSecret(conversion.pem)
  const webhookSecretEnc = encryptSecret(conversion.webhookSecret)
  if (!keyEnc || !webhookSecretEnc) {
    // DOX_AUTH_SECRET vanished mid-flow — refuse rather than store plaintext.
    return redirect(request, { github_app: 'no_auth_secret' })
  }

  await updateAdminSettings({
    githubApp: {
      appId: String(conversion.id),
      slug: conversion.slug,
      htmlUrl: conversion.htmlUrl,
      installationId: null,
      keyEnc,
      webhookSecretEnc,
    },
  })

  // Send the user to install the freshly created app on their org/repos. Thread
  // a new signed state through so Phase 2 (setup_url) stays CSRF-protected.
  const installState = signManifestState()
  const installUrl = new URL(`${conversion.htmlUrl}/installations/new`)
  if (installState) installUrl.searchParams.set('state', installState)
  return NextResponse.redirect(installUrl)
}
