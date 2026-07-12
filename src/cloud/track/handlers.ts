/**
 * Thally Track HTTP handlers. The API route shells under src/app/api do auth +
 * delegation only; the feature logic lives here, behind the cloud bridge, so
 * an OSS build without src/cloud degrades to locked/absent (see
 * src/lib/cloud-bridge/types.ts).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { verifyInstallationBelongsToApp } from '@thallylabs/mcp/track'
import { getTrackingConfig } from '@/data/docs'
import { getStorage } from '@/lib/storage'
import { siteConfig } from '@/data/site'
import { getAdminSettings, updateAdminSettings, getDecryptedGithubApp } from '@/lib/admin/settings'
import { encryptSecret, decryptSecret } from '@/lib/admin/secrets'
import { computeAgentReadiness } from '@/lib/agent-readiness'
import type { TrackedRepoStatus } from '@/lib/cloud-bridge/types'
import { parseRepo } from '@/cloud/track/tasks'
import { buildAppManifest, signManifestState, exchangeManifestCode, verifyManifestState } from '@/cloud/track/github-app'
import { verifyGithubSignature, matchPullRequestEvent, processPullRequest } from '@/cloud/track/webhook'
import { buildReadinessFixInstruction, dispatchDocsAgent } from '@/cloud/track/dispatch-agent'

// ---------------------------------------------------------------------------
// POST /api/track/webhook — merged pull_request events from tracked repos
// ---------------------------------------------------------------------------

/**
 * Response contract: 401 for bad/missing signature (or unconfigured secret,
 * fail-closed); 200 for every no-op (with a `reason`) — never 5xx, GitHub
 * auto-disables hooks that keep failing; 202 when a task was dispatched.
 */
export async function handleWebhook(request: Request): Promise<Response> {
  // The connected GitHub App (Connect-GitHub flow) carries its own webhook
  // secret; the manual-webhook path uses THALLY_TRACK_WEBHOOK_SECRET. Accept a
  // signature that matches EITHER — a decrypt failure just drops that candidate.
  const app = await getDecryptedGithubApp().catch(() => null)
  const secrets = [(process.env.THALLY_TRACK_WEBHOOK_SECRET ?? process.env.DOX_TRACK_WEBHOOK_SECRET)?.trim(), app?.webhookSecret ?? undefined].filter(
    (s): s is string => Boolean(s),
  )
  if (secrets.length === 0) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 401 })
  }

  // HMAC is over the raw bytes — read text BEFORE parsing.
  const raw = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  if (!secrets.some((secret) => verifyGithubSignature(raw, signature, secret))) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 })
  }

  const event = request.headers.get('x-github-event')
  if (event === 'ping') return NextResponse.json({ ok: true, pong: true })
  if (event !== 'pull_request') return NextResponse.json({ ok: true, noop: true, reason: 'unhandled_event' })

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: true, noop: true, reason: 'invalid_json' })
  }

  // Everything past signature verification is wrapped: a storage/network hiccup
  // must return 200 (noop), NOT 500 — GitHub auto-disables hooks that keep
  // failing, which would silently take Track offline.
  try {
    const match = matchPullRequestEvent(payload, getTrackingConfig())
    if (!match) return NextResponse.json({ ok: true, noop: true, reason: 'not_tracked' })

    // Dispatch target = a DEPLOYER-set value (the THALLY_REPO_URL env or the
    // git-committed siteConfig.repoUrl), NOT the admin-editable override —
    // routing secret-bearing Actions shouldn't change via an unreviewed
    // dashboard edit. THALLY_REPO_URL lets a deployment that keeps site.ts as the
    // template default (repoUrl: '') still point Track at its own repo.
    const repoForDispatch = (process.env.THALLY_REPO_URL ?? process.env.DOX_REPO_URL)?.trim() || siteConfig.repoUrl
    const docsRef = repoForDispatch ? parseRepo(repoForDispatch) : null

    const result = await processPullRequest(match, {
      storage: getStorage(),
      docsRepo: docsRef ? `${docsRef.owner}/${docsRef.repo}` : null,
      // Prefer the connected App's installation token; else the resolver falls
      // back to the env PAT chain.
      appCreds: app ? { appId: app.appId, installationId: app.installationId, privateKey: app.privateKey } : undefined,
    })

    if (result.status === 'dispatched') {
      return NextResponse.json({ ok: true, dispatched: true }, { status: 202 })
    }
    return NextResponse.json({ ok: true, noop: true, reason: result.reason })
  } catch (err) {
    console.error('[track] webhook processing error:', err)
    return NextResponse.json({ ok: true, noop: true, reason: 'processing_error' })
  }
}

// ---------------------------------------------------------------------------
// /api/admin/github-app — "Connect GitHub" (status / begin / disconnect)
// Auth (owner-only, manage_team) is enforced by the route shells.
// ---------------------------------------------------------------------------

export async function githubAppStatus(): Promise<Response> {
  const app = (await getAdminSettings()).githubApp
  return NextResponse.json({
    connected: Boolean(app),
    installed: Boolean(app?.installationId),
    slug: app?.slug ?? null,
    htmlUrl: app?.htmlUrl ?? null,
    installationId: app?.installationId ?? null,
  })
}

export async function githubAppBegin(request: NextRequest): Promise<Response> {
  const state = signManifestState()
  if (!state) {
    return NextResponse.json(
      { error: 'Set THALLY_AUTH_SECRET (≥16 chars) before connecting a GitHub App — it secures the flow and encrypts the key.' },
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

export async function githubAppDisconnect(): Promise<Response> {
  await updateAdminSettings({ githubApp: null })
  return NextResponse.json({ connected: false })
}

// ---------------------------------------------------------------------------
// GET /api/admin/github-app/callback — manifest-flow redirects
// ---------------------------------------------------------------------------

function callbackRedirect(request: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL('/admin/settings', request.url)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

/**
 * GitHub hits this twice, both as browser redirects that carry the owner's
 * admin session cookie (the shell verifies it):
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
export async function handleGithubAppCallback(request: NextRequest): Promise<Response> {
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
    if (!app) return callbackRedirect(request, { github_app: 'not_connected' })

    const stateOk = state ? verifyManifestState(state) : false
    let ownershipOk = false
    if (!stateOk) {
      const privateKey = decryptSecret(app.keyEnc)
      if (!privateKey) return callbackRedirect(request, { github_app: 'no_auth_secret' })
      ownershipOk = await verifyInstallationBelongsToApp(app.appId, privateKey, installationId).catch(() => false)
    }
    if (!stateOk && !ownershipOk) return callbackRedirect(request, { github_app: 'bad_state' })

    await updateAdminSettings({ githubApp: { ...app, installationId } })
    return callbackRedirect(request, { github_app: 'connected' })
  }

  // ---- Phase 1: app just created — exchange the code -----------------------
  // CSRF matters here: the one-time `code` exchanges into the app's PRIVATE KEY,
  // so this branch REQUIRES a valid, unexpired, correctly-signed state.
  if (!verifyManifestState(state)) return callbackRedirect(request, { github_app: 'bad_state' })
  if (!code) return callbackRedirect(request, { github_app: 'missing_code' })

  let conversion
  try {
    conversion = await exchangeManifestCode(code)
  } catch {
    return callbackRedirect(request, { github_app: 'exchange_failed' })
  }

  const keyEnc = encryptSecret(conversion.pem)
  const webhookSecretEnc = encryptSecret(conversion.webhookSecret)
  if (!keyEnc || !webhookSecretEnc) {
    // THALLY_AUTH_SECRET vanished mid-flow — refuse rather than store plaintext.
    return callbackRedirect(request, { github_app: 'no_auth_secret' })
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

// ---------------------------------------------------------------------------
// POST /api/admin/agent-fix — dispatch the docs agent on a readiness subscore
// Auth (run_agent) is enforced by the route shell, which passes the requester.
// ---------------------------------------------------------------------------

export async function handleAgentFix(request: NextRequest, requester?: string): Promise<Response> {
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
    requester,
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

// ---------------------------------------------------------------------------
// Admin Tasks page data
// ---------------------------------------------------------------------------

/**
 * Thally Track roster + last relayed PR per repo (written by the webhook).
 * One kvList for the whole namespace, then synchronous lookups — not a
 * per-repo round-trip (which is N network calls on remote storage).
 */
export async function getTrackedRepoStatuses(): Promise<Array<TrackedRepoStatus>> {
  const tracking = getTrackingConfig()
  const stateEntries = await getStorage()
    .kvList<string>('track_state')
    .catch(() => [])
  const stateByKey = new Map(stateEntries.map((entry) => [entry.key, entry.value]))
  return tracking.repos.map((repo) => {
    const branch = repo.branch ?? 'main'
    return {
      owner: repo.owner,
      repo: repo.repo,
      branch,
      paths: repo.paths ?? [],
      outputTab: repo.outputTab,
      lastSyncedPr: stateByKey.get(`${repo.owner}/${repo.repo}@${branch}`.toLowerCase()) ?? null,
    }
  })
}
